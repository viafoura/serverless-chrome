import Cdp from 'chrome-remote-interface'
import config from '../config'
import { log, sleep } from '../utils'
import * as fs from 'fs'

const defaultPrintOptions = {
  landscape: false,
  displayHeaderFooter: false,
  printBackground: true,
  scale: 1,
  paperWidth: 8.5, // aka Letter
  paperHeight: 11, // aka Letter
  marginTop: 0.4,
  marginBottom: 0.4,
  marginLeft: 0.4,
  marginRight: 0.4,
  pageRanges: '',
}

function cleanPrintOptionValue (type, value) {
  const types = { string: String, number: Number, boolean: Boolean }
  return new types[type](value)
}

function makePrintOptions (options = {}) {
  return Object.entries(options).reduce(
    (printOptions, [option, value]) => ({
      ...printOptions,
      [option]: cleanPrintOptionValue(typeof defaultPrintOptions[option], value),
    }),
    defaultPrintOptions
  )
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

export async function printUrlToPdf (url, printOptions = {}) {
  const LOAD_TIMEOUT = (config && config.chrome.pageLoadTimeout) || 1000 * 60
  let result

  const [tab] = await Cdp.List()
  const client = await Cdp({ host: '127.0.0.1', target: tab })

  const { Network, Page } = client

  Network.requestWillBeSent((params) => {
    log('Chrome is sending request for:', params.request.url)
  })


  if (config.logging) {
    Cdp.Version((err, info) => {
      console.log('CDP version info', err, info)
    })
  }

  try {
    await Promise.all([
      Network.enable(), // https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-enable
      Page.enable(), // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-enable
    ])

    const loadEventFired = Page.loadEventFired()

    await Page.navigate({ url }) // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-navigate

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Page load timed out after ${LOAD_TIMEOUT} ms.`)), LOAD_TIMEOUT)
      loadEventFired.then(() => {
        clearTimeout(timeout)
        resolve()
      })
    })

    // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-printToPDF
    const pdf = await Page.printToPDF(printOptions)
    result = pdf.data
  } catch (error) {
    console.error(error)
  }

  /* try {
    log('trying to close tab', tab)
    await Cdp.Close({ id: tab })
  } catch (error) {
    log('unable to close tab', tab, error)
  }*/

  await client.close()

  return result
}

export default (async function printToPdfHandler (event) {
  console.log('got the request');
  const printOptions = makePrintOptions({});
  let pdf
  const rnd = getRandomInt(0, 10000);
  const tmpFile = `/tmp/torender_${rnd}.html`;
  const url = `file://${tmpFile}`;
  console.log("About to read file from event");
  try{
    const buffer = new Buffer(event.body, 'base64');
    fs.writeFileSync(tmpFile, buffer);
    console.log('Processing PDFification for', url, printOptions);
  } catch(error) {
    console.log('Error printing pdf for', url, error);
  }

  const startTime = Date.now()

  try {
    pdf = await printUrlToPdf(url, printOptions)
  } catch (error) {
    console.log('Error printing pdf for', url, error)
    throw new Error('Unable to print pdf')
  }

  const endTime = Date.now()

  console.log('Successfully rendered pdf', pdf.substring(0, 10));
  fs.unlinkSync(tmpFile);
  return {
    statusCode: 200,
    body: pdf,
    headers: {
      'Content-Type': 'application/pdf',
    },
    isBase64Encoded: true
  }
})
