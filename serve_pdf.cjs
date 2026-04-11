const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

const pdfPath = 'C:\\Users\\deepj\\Downloads\\Implementation Plan.pdf';

app.get('/plan.pdf', (req, res) => {
    res.sendFile(pdfPath);
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/plan.pdf`);
});
