import puppeteer from 'puppeteer-core';
import fs from 'fs';

const pdfPath = 'file:///C:/Users/deepj/Downloads/Implementation%20Plan.pdf';
const outputPath = 'C:\\Users\\deepj\\VirtualLinkedin\\virtulinkedAI\\plan_text.txt';

async function main() {
    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Standard path
            headless: true
        });
        const page = await browser.newPage();
        await page.goto(pdfPath, { waitUntil: 'networkidle0' });
        
        // Wait for PDF to load and try to extract text from the viewer
        const text = await page.evaluate(() => {
            // PDF viewer in Chrome exposes content in a way we can sometimes scrape
            // or we can use the plugin structure if available.
            // A more reliable way is to just take a screenshot if text fails,
            // but let's try to find text elements.
            return document.body.innerText;
        });
        
        fs.writeFileSync(outputPath, text || 'No text found', 'utf8');
        console.log('Success');
    } catch (err) {
        console.error('Puppeteer failed:', err);
    } finally {
        if (browser) await browser.close();
    }
}

main();
