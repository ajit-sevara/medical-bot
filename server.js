const express = require('express');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');


// --- ⚙️ CONFIGURATION ---
const BUCKET_NAME = process.env.BUCKET_NAME;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const PORT = process.env.PORT || 3000;

const app = express();
const storage = new Storage({ projectId: GCP_PROJECT_ID });


const jobs = {};


app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.text({ limit: '50mb' })); 


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


app.post('/upload', async (req, res) => {
    
    const { lips, tongue, eyes, nails } = req.body;
    
    
    if (!lips || !tongue || !eyes || !nails) {
        return res.status(400).json({ message: 'Missing one or more images.' });
    }

    
    const jobId = crypto.randomUUID();
    jobs[jobId] = { status: 'processing', result: null };
    console.log(`[${jobId}] New job created.`);

    try {
        
        const [lipsUrl, tongueUrl, eyesUrl, nailsUrl] = await Promise.all([
            uploadImage(lips, `lips-${jobId}`),
            uploadImage(tongue, `tongue-${jobId}`),
            uploadImage(eyes, `eyes-${jobId}`),
            uploadImage(nails, `nails-${jobId}`), 
        ]);
        console.log(`[${jobId}] ⬆️ All images uploaded to GCS.`);

        
        const host = req.get('host');
        const callbackUrl = `https://${host}/webhook-callback?jobId=${jobId}`;
        
        
        const payload = { jobId, callbackUrl, lipsUrl, tongueUrl, eyesUrl, nailsUrl };

        
        fetch(MAKE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log(`[${jobId}] 🚀 Triggered Make.com webhook.`);

       
        res.status(202).json({ jobId: jobId });

    } catch (error) {
        console.error(`[${jobId}] ❌ Error during upload:`, error);
        jobs[jobId].status = 'failed';
        res.status(500).json({ message: 'Error processing your request.' });
    }
});


app.post('/webhook-callback', (req, res) => {
    const { jobId } = req.query;
    const result = req.body;
    
    if (jobs[jobId]) {
        jobs[jobId].status = 'complete';
        jobs[jobId].result = result;
        console.log(`[${jobId}] Job marked as complete.`);
        res.status(200).send('OK');
    } else {
        console.error(`[${jobId}] Job ID not found in callback.`);
        res.status(404).send('Job ID not found');
    }
});


app.get('/status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs[jobId];
    if (job) {
        res.status(200).json(job);
    } else {
        res.status(404).json({ message: "Job not found." });
    }
});


const uploadImage = async (base64, name) => {
    const fileName = `${name}.png`;
    const file = storage.bucket(BUCKET_NAME).file(fileName);
    const buffer = Buffer.from(base64, 'base64');
    await file.save(buffer, { metadata: { contentType: 'image/png' } });
    const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: '03-17-2026' });
    return signedUrl;
};

app.listen(PORT, () => console.log(`🚀 Server is running on http://localhost:${PORT}`));