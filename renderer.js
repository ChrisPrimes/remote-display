let config = null
let slideshowData = null
let currentSlideIndex = 0
let slideshowTimer = null

document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (!window.electronAPI) {
            console.error('electronAPI not available!')
            showError('electronAPI not available')
            return
        }
        
        config = await window.electronAPI.getConfig()
        slideshowData = await window.electronAPI.initializeSlideshow()
        startSlideshow()

    } catch (error) {
        console.error('Failed to initialize app:', error)
        showError('Failed to initialize application: ' + error.message)
    }
})

function startSlideshow() {
    if (!slideshowData || !slideshowData.images || slideshowData.images.length === 0) {
        showError('No media available')
        return
    }

    // Hide loading screen
    const helpText = document.querySelector('.help-text')
    if (helpText) {
        helpText.style.display = 'none'
    }

    // Start the slideshow
    currentSlideIndex = 0
    showSlide()
}

function showSlide() {
    if (!slideshowData || !slideshowData.images) return

    const slides = slideshowData.images
    const imgTag = document.querySelector('#current-image')
    const slideTag = document.querySelector('.slide')
    
    if (!imgTag || !slideTag) {
        console.error('Slideshow elements not found')
        return
    }

    // Construct local file path (using file:// protocol for security)
    const filename = slides[currentSlideIndex].filename
    const localPath = `file://${config.cacheDir}/${config.deploymentId}/${filename}`

    // Update image source
    imgTag.src = localPath
    slideTag.style.display = 'block'

    // Handle image load errors
    imgTag.onerror = () => {
        console.error(`Failed to load image: ${filename}`)
        nextSlide() // Skip to next image
    }

    imgTag.onload = () => {
        // Clear web frame cache to prevent memory leaks
        window.electronAPI.clearCache()
        
        // Schedule next slide
        const duration = (slideshowData.config?.slide_duration || 10) * 1000
        slideshowTimer = setTimeout(nextSlide, duration)
    }
}

function nextSlide() {
    if (slideshowTimer) {
        clearTimeout(slideshowTimer)
        slideshowTimer = null
    }

    currentSlideIndex++
    if (currentSlideIndex >= slideshowData.images.length) {
        currentSlideIndex = 0
    }

    showSlide()
}

function showError(message) {
    console.error(message)
    
    const helpText = document.querySelector('.help-text')
    if (helpText) {
        helpText.style.display = 'flex'
        helpText.innerHTML = `
            <img id="logo" src="icon.png">
            <div style="color: red; margin-top: 20px;">${message}</div>
        `
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (slideshowTimer) {
        clearTimeout(slideshowTimer)
    }
    window.electronAPI.removeAllListeners('slideshow-ready')
})
