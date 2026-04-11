import fs from 'fs';
import { PDFParse } from 'pdf-parse';

const pdfPath = 'C:\\Users\\deepj\\Downloads\\Implementation Plan.pdf';
const outputPath = 'C:\\Users\\deepj\\VirtualLinkedin\\virtulinkedAI\\plan_text.txt';

async function main() {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    // Based on my inspection, PDFParse might be the class/function in this version
    const pdf = new PDFParse();
    const data = await pdf.parse(dataBuffer);
    fs.writeFileSync(outputPath, data.text, 'utf8');
    console.log('Success');
  } catch (err) {
    console.error('Extraction failed:', err);
    process.exit(1);
  }
}

main();
