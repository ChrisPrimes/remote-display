const { app, BrowserWindow, powerSaveBlocker, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { config } = require('process')
const execFile = require('child_process').execFile

const RESTMP_FILE_NAME = 'restmp'
const CONFIG_FILE_NAME = 'config.json'

app.disableHardwareAcceleration()
powerSaveBlocker.start('prevent-display-sleep')

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      preload: path.join(__dirname, 'preload.js')/*,
      devTools: false*/
    },
    fullscreen: true
  })

  mainWindow.loadFile('index.html')

  //mainWindow.webContents.openDevTools()
}

app.whenReady().then(() => {
  let app_data = getAppData()
  let config_file = path.join(app_data, CONFIG_FILE_NAME)

  if (!fs.existsSync(config_file)) {
    dialog.showMessageBoxSync({
      message: "No configuration file was found",
      detail: "File could not be found at " + config_file + ". Update the configuration file and relaunch."
    })
    app.exit(1)
  }

  let config = JSON.parse(fs.readFileSync(config_file))

  ipcMain.on('get-app-support', (event, arg) => {
    event.returnValue = app_data
  })

  ipcMain.on('get-deployment-id', (event, arg) => {
    event.returnValue = config.deployment_id
  })

  ipcMain.on('get-deployment-password', (event, arg) => {
    event.returnValue = config.password
  })

  ipcMain.on('get-app-tenant', (event, arg) => {
    var default_url = "https://signage.prod.chrisprimes.com"

    if (config.hasOwnProperty("tenant")) {
      event.returnValue = config.tenant
    } else {
      event.returnValue = default_url
    }
  })

  ipcMain.on('restart', (event, arg) => {
    fs.writeFileSync(path.join(app_data, RESTMP_FILE_NAME), '' + arg.timestamp)

    const options = {
      args: process.argv.slice(1).concat(['--relaunch']),
      execPath: process.execPath
    }

    // Fix for .AppImage
    if (app.isPackaged && process.env.APPIMAGE) {
      execFile(process.env.APPIMAGE, options.args)
      app.quit()
      return
    }
    
    app.relaunch(options)
    app.quit()
  })

  ipcMain.on('get-last-restart', (event, arg) => {
    let temp_file = path.join(app_data, RESTMP_FILE_NAME)

    if (fs.existsSync(temp_file)) {
      let timestamp = parseInt(fs.readFileSync(temp_file))
      event.returnValue = timestamp
      //fs.unlinkSync(temp_file)
    } else {
      event.returnValue = getCurrentTimestamp()
    }
  })

  ipcMain.on('parse-json', (event, arg) => {
    event.returnValue = JSON.parse(arg)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function getAppData() {
  return path.join(app.getPath('appData'), 'com.chrisprimes.signage')
}

function getCurrentTimestamp() {
  return Math.round(Date.now() / 1000)
}