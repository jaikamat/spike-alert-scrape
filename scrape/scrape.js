const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const pluginStealth = require('puppeteer-extra-plugin-stealth');
const setCodeJSON = require('./setcodes.json');
const fs = require('fs');
const moment = require('moment');

puppeteer.use(pluginStealth());

const BASE_URL = 'https://www.cardsphere.com';

// See http://momentjs.com/docs/#/displaying/format/ for formatting
const filenameDatetime = moment().format('MM-DD-YYYY--x');

/**
 * Returns an array of whole url's based on
 * the BASE_URL, for puppeteer to process
 * @param {array} urls
 */
function processURLs(urls) {
    return urls.map(el => BASE_URL + el);
}

/**
 * Finds all set links from a cheerio object,
 * and returns a list of complete urls
 */
function collectSetLinks($) {
    let links = [];

    $('.sets.row')
        .find('ul > li > a')
        .each((index, element) => {
            links.push($(element).attr('href'));
        });

    return processURLs(links);
}

/**
 * Launches puppeteer and scrapes sets, then navigates to each set
 * page, scraping card data and returning a list array of cards
 */
async function run() {
    console.time('scrape');
    const options = {
        headless: true,
        ignoreHTTPSErrors: true,
        userDataDir: './scrape/tmp' // Use to store session data
    };

    let cardList = [];

    const browser = await puppeteer.launch(options);
    const page = await browser.newPage();

    await page.goto(BASE_URL + '/sets');

    const bodyHTML = await page.evaluate(() => document.body.innerHTML);

    // This is the list of all sets:
    const $_sets = cheerio.load(bodyHTML);

    const links = collectSetLinks($_sets);

    // Iterate over links, collecting card data:
    for (let i = 0; i < links.length; i++) {
        await page.goto(links[i]);
        await page.waitFor(750); // Must wait for ::before and ::after pseudo elements to populate in UI

        const setName = await page.$eval('h3', el => el.innerText.trim());

        // Grabs all card rows in set page, and collects the data
        const cards = await page.evaluate(setCodeJSON => {
            const data = [];
            const rows = document.querySelectorAll('.cards ul > li');
            const setName = document.querySelector('h3').innerText.trim();
            const setCode = setCodeJSON[setName];

            rows.forEach(row => {
                const name = row.querySelector('a').innerText.trim();
                const link = row.querySelector('a').href;

                const price1 = row.querySelector('span:nth-child(2)').innerText.trim();
                const price2 = row.querySelector('span:nth-child(3)').innerText.trim();
                const setIcon = row
                    .querySelector('i')
                    .getAttribute('class')
                    .trim();

                let cardData = {
                    name: name,
                    link: link,
                    price1: price1,
                    price2: price2,
                    setIcon: setIcon,
                    setCode: setCode,
                    setName: setName,
                    isOnlyFoil: false
                };

                // Performs a check to see if only price2 has been logged (means it's only a foil print)
                if (!price1 && price2) {
                    cardData.isOnlyFoil = true;
                }

                data.push(cardData);
            });

            return data;
        }, setCodeJSON);

        // Check to make sure setCode is mapped in JSON
        cardList.forEach(card => {
            if (!card.setCode) {
                throw new Error(`Set code was not defined in JSON mapper for ${card.setName}`);
            }
        });

        // Alert the admin of scrape progress
        console.log(
            `${setName} | ${setCodeJSON[setName] ? setCodeJSON[setName] : 'NONE'} | scraped`
        );

        cardList = cardList.concat(cards);
    }

    await browser.close();
    console.timeEnd('scrape');
    return cardList;
}

// Initialize the scrape
run()
    .then(cards => {
        fs.writeFileSync(`./scrape/scraped_data/${filenameDatetime}.json`, JSON.stringify(cards));
        console.log('Scrape finished');
    })
    .catch(console.error);
