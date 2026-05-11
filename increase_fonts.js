const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory) {
            walkDir(dirPath, callback);
        } else {
            callback(dirPath);
        }
    });
}

const targetDir = path.join(__dirname, 'src');

let count = 0;

walkDir(targetDir, (filePath) => {
    if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
        let content = fs.readFileSync(filePath, 'utf8');
        let originalContent = content;
        
        // Match fontSize: 12
        content = content.replace(/fontSize:\s*(\d+)/g, (match, p1) => {
            return `fontSize: ${parseInt(p1) + 1}`;
        });
        
        // Match fontSize: "12px" or fontSize: '12px'
        content = content.replace(/fontSize:\s*(['"])(\d+)px\1/g, (match, p1, p2) => {
            return `fontSize: ${p1}${parseInt(p2) + 1}px${p1}`;
        });
        
        // Match text-[12px]
        content = content.replace(/text-\[(\d+)px\]/g, (match, p1) => {
            return `text-[${parseInt(p1) + 1}px]`;
        });

        if (content !== originalContent) {
            fs.writeFileSync(filePath, content, 'utf8');
            count++;
            console.log(`Updated ${filePath}`);
        }
    }
});

console.log(`Updated ${count} files.`);
