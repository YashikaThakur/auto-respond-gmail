import express from 'express';
const app = express();
const port = 8000;
import path from 'path';

import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
const gmailId = process.env.GMAIL_ID;

// Routes
app.get("/",async(req,res)=>{
    // Load the credentials from the JSON file

    const auth = await authenticate({
        keyfilePath: path.join(process.cwd(), 'credentials.json'),  
        scopes: ['https://www.googleapis.com/auth/gmail.readonly', 
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.labels',
            'https://mail.google.com/'],
    });

    console.log("auth",auth);
    
    const gmail = google.gmail({version: 'v1', auth});
    const response = await gmail.users.labels.list({
        userId: 'me',
    });

    console.log("response",response);

    const LABEL = 'AutoReply';

    //Get all the unreplied messages
    async function getUnrepliedMessages(auth){
        const gmail = google.gmail({version: 'v1', auth});
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: 'is:unread',
        });
        return response.data.messages||[];
    }

    //Send a reply to the message
    async function sendReply(auth,message){
        const gmail = google.gmail({version: 'v1', auth});
        const response = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From'],
        });

        const subject = response.data.payload.headers.find(
            (header) => header.name === 'Subject').value;
        const from = response.data.payload.headers.find(
            (header) => header.name === 'From').value;
        const replyTo = from.substring(from.indexOf('<')+1,from.indexOf('>'));
        const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
        const replyBody = `Hi,\n\nThanks for your email. I'm currently on a vacation and will get back to you as soon as I can.\n\nBest,\n\n${gmailId}`;
        const rawMessage = [
            `From: me`,
            `To: ${replyTo}`,
            `Subject: ${replySubject}`,
            `In-Reply-To: ${message.id}`,
            `References: ${message.id}`,
            ``,
            replyBody,
        ].join('\n');
        const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });
    }

    //Create a label for the app
    async function createLabel(auth) {
        try{
            const res = await gmail.users.labels.create({
                userId: 'me',
                requestBody: {
                    name: LABEL,
                    labelListVisibility: 'labelShow',
                    messageListVisibility: 'show',
                },
            });
            return res.data.id;
        }catch(error){
            if(error.code === 409){
                const response = await gmail.users.labels.list({
                    userId: 'me',
                });
                const labels = response.data.labels || [];
                const existingLabel = labels.find(label => label.name === LABEL);
                return existingLabel.id;
            }
            else{
               throw error; 
            }
        }
    }
    //Add label to the message
    async function addLabel(auth,message,labelId){
        const gmail = google.gmail({version: 'v1', auth});
        await gmail.users.messages.modify({
            userId: 'me',
            id: message.id,
            requestBody: {
                addLabelIds: [labelId],
                removeLabelIds: ['INBOX'],
            },
        });
    }

    //Main function

    async function main(){
        const labelId = await createLabel(auth);
        console.log("labelId",labelId);

        setInterval(async()=>{
            const messages = await getUnrepliedMessages(auth);
            console.log(`Found ${messages.length} unreplied messages`);
            for(const message of messages){
                await sendReply(auth,message);
                console.log(`Replied to message with id: ${message.id}`);

                await addLabel(auth,message,labelId);
                console.log(`Added label to message with id: ${message.id}`);
            }
        },Math.floor(Math.random() * (120 - 45 + 1)) + 45 * 1000);
    }

    main().catch(console.error);

    res.send("You have successfully subscribed to the Auto Reply App !");
});


app.listen(port,()=>{
    console.log(`Server is running on port ${port} at http://localhost:${port}`);
});