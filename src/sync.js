const fs = require('fs')
const axios = require('axios')
const browserify = require('browserify')
const promisify = require('util').promisify
const log = require('./lib/log')
const { POSTMAN_API_BASE } = require('./lib/constants')
let command

module.exports = function sync (cmd) {
  command = cmd._name
  exec()
}

async function exec () {
  const { POSTMAN_API_KEY, POSTMAN_COLLECTION_ID, POSTMAN_COLLECTION_FILENAME } = require('./lib/config')
  const apiKeyParam = `?apikey=${POSTMAN_API_KEY}`
  const apiAddress = `${POSTMAN_API_BASE}/collections/${POSTMAN_COLLECTION_ID}/${apiKeyParam}`
  const res = await axios.get(apiAddress)
  const collection = res.data.collection

  if (collection.item) {
    await checkCollectionItems(collection.item)
  }

  if (command === 'bootstrap') {
    log.success('Files written!')
  }

  if (command === 'sync') {
    fs.writeFileSync(POSTMAN_COLLECTION_FILENAME, JSON.stringify(collection, null, 2))
    log.success(`${POSTMAN_COLLECTION_FILENAME} written!`)
  }

  if (command === 'update') {
    axios.put(apiAddress, { collection })
    log.success('Postman updated!')
  }
}

async function checkCollectionItems (items, context) {
  for await (const item of items) {
    if (item.request) {
      if (command === 'bootstrap') {
        mapScriptToFile(item, context)
      } else {
        await mapFileToScript(item, context)
      }
    } else {
      // is folder
      context = context ? context + '/' : ''
      await checkCollectionItems(item.item, context + item.name)
    }
  }
}

/**
 * Takes postman request and splits it into different files
 * @param req
 * @param context
 */
function mapScriptToFile (req, context = '') {
  mapSectionToFile(req, context, 'file')
  mapSectionToFile(req, context, 'prerequest')
}

/**
 * Finds the script section in the event of a postman request and writes it out into a file
 * @param req
 * @param context
 * @param sectionName
 */
function mapSectionToFile (req, context = '', sectionName) {
  const config = require('./lib/config')
  const section = req.event && req.event.find((el) => el.listen === sectionName)
  const sectionScriptJsString = section && section.script.exec.join('\n')
  const path = `${config.POSTMAN_TEST_DIR}/${context}/${req.name}`

  if (sectionScriptJsString && !fs.existsSync(`${path}/${sectionName}.js`)) {
    fs.mkdirSync(path, { recursive: true })
    fs.writeFileSync(`${path}/${sectionName}.js`, sectionScriptJsString)
  }
}

/**
 * Merges source files back into a request object
 * @param req
 * @param context
 * @returns {Promise<void>}
 */
async function mapFileToScript (req, context = '') {
  const testIndex = req.event.findIndex((el) => el.listen === 'test')
  req.event[testIndex].script.exec = mapFileToSection(req, context, 'test')

  const preRequestindex = req.event.findIndex((el) => el.listen === 'prerequest')
  req.event[preRequestindex].script.exec = mapFileToSection(req, context, 'prerequest')
}

/**
 * Takes a source file, bundles, and then converts it into a format necessary to create a postman request script field
 * @param req
 * @param context
 * @param sectionName
 * @returns {Promise<string|string[]>}
 */
async function mapFileToSection (req, context = '', sectionName) {
  const config = require('./lib/config')
  const testPath = `${config.POSTMAN_TEST_DIR}/${context}/${req.name}/${sectionName}.js`

  if (fs.existsSync(testPath)) {
    const b = browserify()
    b.add(testPath)

    const doBundle = promisify(b.bundle.bind(b))
    const buf = await doBundle()
    const script = buf.toString()

    return script.split('\n')
  } else {
    return ''
  }
}
