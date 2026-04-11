const puppeteer = require('puppeteer-core');
const fs = require('fs');
const http = require('http');

async function getDebuggerUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/version', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data).webSocketDebuggerUrl);
        } catch(e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

(async () => {
  console.log("Connecting to active browser...");
  let browserUrl;
  try {
     browserUrl = await getDebuggerUrl();
  } catch(e) {
     console.error("Could not connect to browser on 9222", e);
     return;
  }
  
  const browser = await puppeteer.connect({ browserWSEndpoint: browserUrl, defaultViewport: null });
  const pages = await browser.pages();
  let page = pages.find(p => p.url().includes('linkedin.com/search') || p.url().includes('linkedin.com/in'));
  
  if (!page) {
     console.log("No LinkedIn page found. Please open search results.");
     process.exit(1);
  }

  console.log("Found page:", page.url());
  if (page.url().includes('/in/')) {
     console.log("Going back to search...");
     page.goBack().catch(e => console.log("goBack error", e));
     await new Promise(r => setTimeout(r, 4000));
  }

  await new Promise(r => setTimeout(r, 3000));
  
  console.log("--- LAZYCOLUMN HYDRATION TEST ---");
  
  try {
    let mainHtml = await page.evaluate(() => {
        let main = document.querySelector('main');
        return main ? main.outerHTML : "NO MAIN";
    });
    require('fs').writeFileSync('main_dump.html', mainHtml);
    console.log("Dumped main to main_dump.html");
  } catch(e) {
    console.log("ERROR", e);
  }

  console.log("Test finished.");
  process.exit(0);
})();
