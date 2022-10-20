const fs = require('fs')
const fetch = require('node-fetch')
const path = require('path')
const { ipcRenderer, webFrame } = require('electron')
const log = require('electron-log')

const PLAYER_FILE_NAME = 'player.json'

const server_url = ipcRenderer.sendSync('get-app-tenant', '')
const deployment_id = ipcRenderer.sendSync('get-deployment-id', '')
const cache_dir = ipcRenderer.sendSync('get-app-support', '')
const password = ipcRenderer.sendSync('get-deployment-password', '')

const lastRestartTimestamp = ipcRenderer.sendSync('get-last-restart', '')

var retry_count = 0

log.transports.file.resolvePath = () => path.join(cache_dir, 'log.txt')
log.transports.file.level = 'info'

window.addEventListener('DOMContentLoaded', () => {
  log.info('DEPLOYMENT ID: ' + deployment_id)
  log.info('CACHE DIR: ' + cache_dir)
  log.info('SERVER URL: ' + server_url)

  if (!fs.existsSync(cache_dir)) {
    fs.mkdirSync(cache_dir, {
      recursive: true
    })
  }

  connectToServer()
  checkForRestart()
})

function connectToServer() {
  // Cache local copy of server content
  var httpRequest = new XMLHttpRequest()
  httpRequest.addEventListener("load", function () {
    log.info("Established server connection")

    let data = ipcRenderer.sendSync('parse-json', this.responseText)

    fs.writeFileSync(path.join(cache_dir, PLAYER_FILE_NAME), JSON.stringify(data, null, 2))

    number_images = data.images.length
    data.images.forEach(element => {
      let local_path = path.join(cache_dir, "" + deployment_id, element.filename)
      let url = server_url + element.path
      if (!fs.existsSync(local_path)) {
        let directory = path.dirname(local_path)
        if (!fs.existsSync(directory)) {
          fs.mkdirSync(directory, {
            recursive: true
          })
        }

        downloadImage(url, local_path)
        
      } else {
        number_images--
      }
    })

    init()
  })

  httpRequest.addEventListener("error", function () {
    if (retry_count < 10) {
      log.info('Cannot connect to server. Retry (' + (retry_count + 1) + '/10)')
      retry_count++
      setTimeout(connectToServer, 30000)

    } else {
      log.info('Unable to connect to the server.  Running cached copy of content.')

      // Since we are running on cache, we don't need to download any images, so we can manually set to zero.
      number_images = 0
      init()
    }

  })

  httpRequest.open("GET", server_url + "/player?deployment_id=" + deployment_id + "&password=" + password)
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
    number_images--
  })
}

function showSlides(playerData, duration, slideIndex) {
  let slides = playerData.images
  let imgTag = document.querySelector("#current-image")
  let slideTag = document.querySelector(".slide")
  let local_path = path.join(cache_dir, "" + deployment_id, slides[slideIndex].filename)

  imgTag.setAttribute('src', local_path)
  slideTag.style.display = "block"

  slideIndex++

  if (slideIndex >= slides.length) {
    slideIndex = 0
  }

  webFrame.clearCache();

  setTimeout(function() {
    showSlides(playerData, duration, slideIndex)
    }, duration * 1000)
}

function init() {
  // Read cached copy of JSON config
  fs.readFile(path.join(cache_dir, PLAYER_FILE_NAME), 'utf8', function (err, httpData) {
    if (err) {
      throw err
    }

    if (number_images > 0) {
      setTimeout(init, 1000)
      return
    }

    document.querySelector('.help-text').style.display = "none"

    var data = ipcRenderer.sendSync('parse-json', httpData)

    var duration = data.config.slide_duration

    showSlides(data, duration, 0)
  })
}

function checkForRestart() {
  var httpRequest = new XMLHttpRequest()
  httpRequest.addEventListener("load", function () {

    let data = ipcRenderer.sendSync('parse-json', this.responseText)

    if (data.result == 'success') {
      const restartTimestamp = data.control.restart

      if (restartTimestamp > lastRestartTimestamp) {
        // We need to restart the application

        log.info("Restart needed: " + restartTimestamp)
        log.info("Last restart:   " + lastRestartTimestamp)
        
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

  httpRequest.open("GET", server_url + "/control?deployment_id=" + deployment_id + "&password=" + password)
  httpRequest.send()
}