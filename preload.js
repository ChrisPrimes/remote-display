const fs = require('fs')
const fetch = require('node-fetch')
const path = require('path')
const { ipcRenderer, webFrame } = require('electron')
const log = require('electron-log')

const PLAYER_FILE_NAME = 'player.json'

const SERVER_URL = ipcRenderer.sendSync('get-app-tenant', '')
const DEPLOYMENT_ID = ipcRenderer.sendSync('get-deployment-id', '')
const CACHE_DIR = ipcRenderer.sendSync('get-app-support', '')
const PASSWORD = ipcRenderer.sendSync('get-deployment-password', '')
const LAST_RESTART_TIMESTAMP = ipcRenderer.sendSync('get-last-restart', '')

let retryCount = 0
let numberImages = -1

log.transports.file.resolvePath = () => path.join(CACHE_DIR, 'log.txt')
log.transports.file.level = 'info'

window.addEventListener('DOMContentLoaded', () => {
  log.info('DEPLOYMENT ID: ' + DEPLOYMENT_ID)
  log.info('CACHE DIR: ' + CACHE_DIR)
  log.info('SERVER URL: ' + SERVER_URL)

  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, {
      recursive: true
    })
  }

  connectToServer()
  checkForRestart()
})

function connectToServer() {
  // Cache local copy of server content
  let httpRequest = new XMLHttpRequest()
  httpRequest.addEventListener("load", function () {
    log.info("Established server connection")

    let data = ipcRenderer.sendSync('parse-json', this.responseText)

    fs.writeFileSync(path.join(CACHE_DIR, PLAYER_FILE_NAME), JSON.stringify(data, null, 2))

    numberImages = data.images.length
    data.images.forEach(element => {
      let localPath = path.join(CACHE_DIR, "" + DEPLOYMENT_ID, element.filename)
      let url = element.path
      if (!fs.existsSync(localPath)) {
        let directory = path.dirname(localPath)
        if (!fs.existsSync(directory)) {
          fs.mkdirSync(directory, {
            recursive: true
          })
        }

        downloadImage(url, localPath)

      } else {
        numberImages--
      }
    })

    init()
  })

  httpRequest.addEventListener("error", function () {
    if (retryCount < 10) {
      log.info('Cannot connect to server. Retry (' + (retryCount + 1) + '/10)')
      retryCount++
      setTimeout(connectToServer, 30000)

    } else {
      log.info('Unable to connect to the server.  Running cached copy of content.')

      // Since we are running on cache, we don't need to download any images, so we can manually set to zero.
      numberImages = 0
      init()
    }

  })

  httpRequest.open("GET", SERVER_URL + "/player?deployment_id=" + DEPLOYMENT_ID + "&password=" + PASSWORD)
  httpRequest.send()
}

async function downloadImage(url, destination) {
  log.info("Downloading: " + url + " to " + destination)
  const response = await fetch(url)
  const buffer = await response.buffer()
  fs.writeFile(destination, buffer, (err) => {
    if (err) {
      throw err
    }
    numberImages--
  })
}

function showSlides(playerData, duration, slideIndex) {
  let slides = playerData.images
  let imgTag = document.querySelector("#current-image")
  let slideTag = document.querySelector(".slide")
  let localPath = path.join(CACHE_DIR, "" + DEPLOYMENT_ID, slides[slideIndex].filename)

  imgTag.setAttribute('src', localPath)
  slideTag.style.display = "block"

  slideIndex++

  if (slideIndex >= slides.length) {
    slideIndex = 0
  }

  webFrame.clearCache()

  setTimeout(function () {
    showSlides(playerData, duration, slideIndex)
  }, duration * 1000)
}

function init() {
  // Read cached copy of JSON config
  fs.readFile(path.join(CACHE_DIR, PLAYER_FILE_NAME), 'utf8', function (err, httpData) {
    if (err) {
      throw err
    }

    if (numberImages > 0) {
      setTimeout(init, 1000)
      return
    }

    document.querySelector('.help-text').style.display = "none"

    let data = ipcRenderer.sendSync('parse-json', httpData)

    let duration = data.config.slide_duration

    cleanupCache(data)
    showSlides(data, duration, 0)
  })
}

function checkForRestart() {
  let httpRequest = new XMLHttpRequest()
  httpRequest.addEventListener("load", function () {

    let data = ipcRenderer.sendSync('parse-json', this.responseText)

    if (data.result == 'success') {
      const restartTimestamp = data.control.restart

      if (restartTimestamp > LAST_RESTART_TIMESTAMP) {
        // We need to restart the application

        log.info("Restart needed: " + restartTimestamp)
        log.info("Last restart:   " + LAST_RESTART_TIMESTAMP)

        ipcRenderer.sendSync('restart', {
          timestamp: restartTimestamp
        })
      } else {
        log.debug("Heartbeat, no restart needed.")
        setTimeout(checkForRestart, 60000)
      }

    } else {
      log.debug("Heartbeat result was not success.")
      setTimeout(checkForRestart, 60000)
    }
  })

  httpRequest.addEventListener("error", function () {
    log.debug("Heartbeat connection error.")
    setTimeout(checkForRestart, 60000)
  })

  httpRequest.open("GET", SERVER_URL + "/control?deployment_id=" + DEPLOYMENT_ID + "&password=" + PASSWORD)
  httpRequest.send()
}

function cleanupCache(playerData) {
  let slides = playerData.images
  let deploymentDir = path.join(CACHE_DIR, "" + DEPLOYMENT_ID)
  let serverFiles = Array()

  slides.forEach(element => {
    serverFiles.push(element.filename)
  })

  fs.readdir(deploymentDir, function (err, localFiles) {
    if (err) {
      throw err
    }

    localFiles.forEach(element => {
      if (!serverFiles.includes(element)) {
        let filePath = path.join(deploymentDir, element)

        if (!fs.lstatSync(filePath).isDirectory()) {
          log.info("Extra file found: " + element)
          fs.unlinkSync(filePath)
        }
      }
    })
  })
}