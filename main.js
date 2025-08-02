const { app, BrowserWindow, powerSaveBlocker, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs').promises
const fsSync = require('fs')
const execFile = require('child_process').execFile
const log = require('electron-log/main')

const RESTMP_FILE_NAME = 'restmp'
const CONFIG_FILE_NAME = 'config.json'
const PLAYER_FILE_NAME = 'player.json'
const CHECK_FOR_RESTART_INTERVAL = 900000

let config = null
let appData = null
let slideshowData = null
let initializationPromise = null

// Initialize logging
log.initialize()

app.disableHardwareAcceleration()
powerSaveBlocker.start('prevent-display-sleep')

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    fullscreen: true
  })

  mainWindow.loadFile('index.html')

  // Only enable dev tools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  return mainWindow
}

app.whenReady().then(async () => {
  appData = getAppData()
  const configFile = path.join(appData, CONFIG_FILE_NAME)

  if (!fsSync.existsSync(configFile)) {
    dialog.showMessageBoxSync({
      message: "No configuration file was found",
      detail: "File could not be found at " + configFile + ". Update the configuration file and relaunch."
    })
    app.exit(1)
  }

  try {
    config = JSON.parse(await fs.readFile(configFile, 'utf8'))
  } catch (error) {
    dialog.showMessageBoxSync({
      message: "Invalid configuration file",
      detail: "Error parsing " + configFile + ": " + error.message
    })
    app.exit(1)
  }

  // Configure logging
  log.transports.file.resolvePathFn = () => path.join(appData, 'log.txt')
  log.transports.file.level = 'info'

  // Ensure cache directory exists
  await ensureCacheDirectory()

  // Register IPC handlers
  registerIpcHandlers()

  const mainWindow = createWindow()

  // Start slideshow initialization in background
  initializationPromise = initializeSlideshow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
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

function getServerUrl() {
  const defaultUrl = "https://signage.prod.chrisprimes.com"
  return config.tenant || defaultUrl
}

async function ensureCacheDirectory() {
  try {
    await fs.mkdir(appData, { recursive: true })
    const deploymentDir = path.join(appData, String(config.deployment_id))
    await fs.mkdir(deploymentDir, { recursive: true })
  } catch (error) {
    log.error('Failed to create cache directory:', error)
    throw error
  }
}

function registerIpcHandlers() {
  // Get configuration data
  ipcMain.handle('get-config', async () => {
    return {
      deploymentId: String(config.deployment_id),
      serverUrl: getServerUrl(),
      cacheDir: appData,
      lastRestartTimestamp: await getLastRestartTimestamp()
    }
  })

  // Initialize slideshow - called when renderer is ready
  ipcMain.handle('initialize-slideshow', async () => {
    // Wait for initialization to complete if it's still running
    if (initializationPromise) {
      await initializationPromise
    }
    
    if (!slideshowData) {
      throw new Error('Slideshow initialization failed')
    }
    
    return slideshowData
  })
}

async function getLastRestartTimestamp() {
  const tempFile = path.join(appData, RESTMP_FILE_NAME)
  
  try {
    const timestamp = await fs.readFile(tempFile, 'utf8')
    return parseInt(timestamp)
  } catch (error) {
    return getCurrentTimestamp()
  }
}

async function fetchFromServer(endpoint) {
  const serverUrl = getServerUrl()
  const url = `${serverUrl}${endpoint}?deployment_id=${config.deployment_id}&password=${config.password}`
  
  // Add timeout to prevent hanging
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Remote Display Client'
      }
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    return response.json()
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('Request timeout after 10 seconds')
    }
    throw error
  }
}

async function downloadImage(imageUrl, destination) {
  log.info(`Downloading: ${imageUrl} to ${destination}`)
  
  const response = await fetch(imageUrl)
  
  if (!response.ok) {
    throw new Error(`Failed to download image: HTTP ${response.status}`)
  }
  
  const buffer = await response.arrayBuffer()
  await fs.writeFile(destination, Buffer.from(buffer))
}

async function cacheImages(images) {
  const downloadPromises = []
  
  for (const image of images) {
    const localPath = path.join(appData, String(config.deployment_id), image.filename)
    
    try {
      await fs.access(localPath)
      log.debug(`Image already cached: ${image.filename}`)
    } catch (error) {
      // File doesn't exist, need to download
      downloadPromises.push(downloadImage(image.path, localPath))
    }
  }
  
  if (downloadPromises.length > 0) {
    log.info(`Downloading ${downloadPromises.length} images...`)
    await Promise.all(downloadPromises)
    log.info('All images downloaded successfully')
  }
}

async function cleanupCache(currentImages) {
  const deploymentDir = path.join(appData, String(config.deployment_id))
  const currentFiles = currentImages.map(img => img.filename)
  
  try {
    const localFiles = await fs.readdir(deploymentDir)
    
    for (const file of localFiles) {
      if (!currentFiles.includes(file)) {
        const filePath = path.join(deploymentDir, file)
        const stats = await fs.lstat(filePath)
        
        if (!stats.isDirectory()) {
          log.info(`Removing extra file: ${file}`)
          await fs.unlink(filePath)
        }
      }
    }
  } catch (error) {
    log.error('Failed to cleanup cache:', error)
  }
}

async function connectToServer(retryCount = 0) {
  const maxRetries = 10
  
  try {
    log.info('Connecting to server...')
    const data = await fetchFromServer('/player')
    
    // Cache the response
    await fs.writeFile(
      path.join(appData, PLAYER_FILE_NAME),
      JSON.stringify(data, null, 2)
    )
    
    // Download missing images
    await cacheImages(data.images)
    
    // Cleanup old images
    await cleanupCache(data.images)
    
    slideshowData = data
    log.info('Server connection established and images cached')
    
  } catch (error) {
    log.error(`Failed to connect to server (attempt ${retryCount + 1}/${maxRetries}):`, error.message)
    
    if (retryCount < maxRetries - 1) {
      const delay = Math.min(30000 * Math.pow(1.5, retryCount), 300000) // Exponential backoff, max 5 min
      log.info(`Retrying in ${delay / 1000} seconds...`)
      
      await new Promise(resolve => setTimeout(resolve, delay))
      return connectToServer(retryCount + 1)
    } else {
      log.info('Max retries reached. Attempting to use cached data.')
      await loadCachedData()
    }
  }
}

async function loadCachedData() {
  try {
    const cachedData = await fs.readFile(path.join(appData, PLAYER_FILE_NAME), 'utf8')
    slideshowData = JSON.parse(cachedData)
    log.info('Using cached slideshow data')
  } catch (error) {
    log.error('Failed to load cached data:', error)
    throw new Error('No server connection and no cached data available')
  }
}

async function checkForRestart() {
  try {
    const data = await fetchFromServer('/control')
    
    if (data.result === 'success') {
      const restartTimestamp = data.control.restart
      const lastRestart = await getLastRestartTimestamp()
      
      if (restartTimestamp > lastRestart) {
        log.info(`Restart needed: ${restartTimestamp}`)
        log.info(`Last restart: ${lastRestart}`)
        
        await fs.writeFile(path.join(appData, RESTMP_FILE_NAME), String(restartTimestamp))
        
        const options = {
          args: process.argv.slice(1).concat(['--relaunch']),
          execPath: process.execPath
        }

        if (app.isPackaged && process.env.APPIMAGE) {
          execFile(process.env.APPIMAGE, options.args)
          app.quit()
          return
        }
        
        app.relaunch(options)
        app.quit()
        return
      } else {
        log.debug('Heartbeat: no restart needed')
      }
    } else {
      log.debug('Heartbeat: result was not success')
    }
  } catch (error) {
    log.debug('Heartbeat connection error:', error.message)
  }
  
  // Schedule next check
  setTimeout(checkForRestart, CHECK_FOR_RESTART_INTERVAL)
}

async function initializeSlideshow() {
  try {
    // Connect to server and cache images
    await connectToServer()
    
    // Start restart checking
    setTimeout(checkForRestart, CHECK_FOR_RESTART_INTERVAL)
    
    log.info('Slideshow initialization complete')
    
  } catch (error) {
    log.error('Failed to initialize slideshow:', error)
    throw error
  }
}