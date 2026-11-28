/*
* Vieb - Vim Inspired Electron Browser
* Copyright (C) 2019-2026 Jelmer van Arnhem
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import {ipcRenderer} from "electron"
import {platform} from "node:os"
import {
    appData,
    domainName,
    joinPath,
    matchesQuery,
    readJSON,
    urlToString,
    writeJSON
} from "../util.js"
import {getMouseConf, getSetting} from "./settings.js"
import {
    currentMode,
    currentPage,
    listReadyPages,
    pageContainerPos,
    pageOffset,
    sendToPageOrSubFrame,
    tabForPage
} from "./util.js"

let X = 0
let Y = 0
let startX = 0
let startY = 0
let listenForScroll = false
let lastSelection = {"endX": 0, "endY": 0, "startX": 0, "startY": 0}
/** @type {typeof lastSelection|null} */
let mouseSelection = null
let skipNextClick = false

/** Return the x position taking zoom into account. */
const zoomX = () => Math.round(X / (currentPage()?.getZoomFactor() ?? 1))

/** Return the y position taking zoom into account. */
const zoomY = () => Math.round(Y / (currentPage()?.getZoomFactor() ?? 1))

/** Update the pointer position to respect bounds and send the new hover. */
export const updateElement = async() => {
    const pointerEl = document.getElementById("pointer")
    const page = currentPage()
    if (!pointerEl || !page) {
        return
    }
    const {bottom, left, right, top} = pageOffset(page)
    const guifontsize = getSetting("guifontsize")
    X = Math.max(0, Math.min(X, right - left - guifontsize * 1.4))
    Y = Math.max(0, Math.min(Y, bottom - top - guifontsize))
    pointerEl.style.left = `${X + left}px`
    pointerEl.style.top = `${Y + top}px`
    currentPage()?.setAttribute("pointer-x", `${X}`)
    currentPage()?.setAttribute("pointer-y", `${Y}`)
    if (currentMode() === "pointer") {
        await sendToPageOrSubFrame("send-input-event",
            {"type": "hover", "x": X, "y": Y})
    }
    if (currentMode() === "visual") {
        lastSelection = {"endX": X, "endY": Y, startX, startY}
        const factor = currentPage()?.getZoomFactor() ?? 1
        await sendToPageOrSubFrame("action", "selectionRequest",
            Math.round(startX / factor), Math.round(startY / factor),
            zoomX(), zoomY())
    }
}

/**
 * Move the pointer.
 * @param {number} x
 * @param {number} y
 */
export const move = async(x, y) => {
    X = x
    Y = y
    await updateElement()
}

/**
 * Handle a difference in scroll height.
 * @param {number} diff
 */
export const handleScrollDiffEvent = async diff => {
    startY += diff
    if (listenForScroll) {
        Y += diff
        await updateElement()
        listenForScroll = false
    }
}

/** Remove the hover and selection from the page. */
export const releaseKeys = async() => {
    try {
        await sendToPageOrSubFrame("send-input-event",
            {"type": "leave", "x": X, "y": Math.max(1, Y)})
        await sendToPageOrSubFrame("action", "selectionRemove",
            zoomX(), zoomY())
    } catch {
        // Can't release keys, probably because of opening a new tab
    }
    mouseSelection = null
}

/**
 * Store the latest mouse selection.
 * @param {typeof lastSelection|null} selection
 */
export const storeMouseSelection = selection => {
    mouseSelection = selection
}

// ACTIONS

/**
 * Start pointer mode.
 * @param {{x?: number, y?: number} | null} args
 */
export const start = async(args = null) => {
    X = args?.x || Number(currentPage()?.getAttribute("pointer-x")) || X
    Y = args?.y || Number(currentPage()?.getAttribute("pointer-y")) || Y
    const {setMode} = await import("./modes.js")
    await setMode("pointer")
    await sendToPageOrSubFrame("send-input-event",
        {"type": "hover", "x": X, "y": Y})
    await updateElement()
}

/** Move the pointer to the current mouse position. */
export const moveToMouse = async() => {
    const mousePos = await ipcRenderer.invoke("mouse-location")
    if (mousePos) {
        for (const el of document.elementsFromPoint(mousePos.x, mousePos.y)) {
            if (!(el instanceof HTMLElement
                && matchesQuery(el, "webview[link-id]"))) {
                continue
            }
            if (el !== currentPage() || currentMode() !== "visual") {
                const {switchToTab} = await import("./tabs.js")
                // @ts-expect-error el is checked to be a webview above
                await switchToTab(tabForPage(el))
            }
            const containerPos = pageContainerPos()
            if (currentMode() === "visual") {
                X = mousePos.x - containerPos.left
                Y = mousePos.y - containerPos.top
                await updateElement()
            } else {
                await start({
                    "x": mousePos.x - containerPos.left,
                    "y": mousePos.y - containerPos.top
                })
            }
        }
    }
}

/** Restore the previous visual mode selection. */
export const restoreSelection = async() => {
    ({"endX": X, "endY": Y, startX, startY} = mouseSelection || lastSelection)
    mouseSelection = null
    const {setMode} = await import("./modes.js")
    await setMode("visual")
    await updateElement()
}

/**
 * Open the audio src in a new split.
 * @param {import("./actions.js").ActionParam} args
 */
export const splitAudio = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "split",
    "src": args.src,
    "type": "audio",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the frame src in a new split.
 * @param {import("./actions.js").ActionParam} args
 */
export const splitFrame = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "split",
    "src": args.src,
    "type": "frame",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the hover link src in a new split.
 * @param {import("./actions.js").ActionParam} args
 */
export const splitLink = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "split",
    "src": args.src,
    "type": "link",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the image src in a new split.
 * @param {import("./actions.js").ActionParam} args
 */
export const splitImage = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "split",
    "src": args.src,
    "type": "img",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the video src in a new split.
 * @param {import("./actions.js").ActionParam} args
 */
export const splitVideo = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "split",
    "src": args.src,
    "type": "video",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the audio src in a new vertical split.
 * @param {import("./actions.js").ActionParam} args
 */
export const vsplitAudio = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "vsplit",
    "src": args.src,
    "type": "audio",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the frame src in a new vertical split.
 * @param {import("./actions.js").ActionParam} args
 */
export const vsplitFrame = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "vsplit",
    "src": args.src,
    "type": "frame",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the hover link in a new vertical split.
 * @param {import("./actions.js").ActionParam} args
 */
export const vsplitLink = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "vsplit",
    "src": args.src,
    "type": "link",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the image src in a new vertical split.
 * @param {import("./actions.js").ActionParam} args
 */
export const vsplitImage = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "vsplit",
    "src": args.src,
    "type": "img",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the video src in a new vertical split.
 * @param {import("./actions.js").ActionParam} args
 */
export const vsplitVideo = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "vsplit",
    "src": args.src,
    "type": "video",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Download the audio src.
 * @param {import("./actions.js").ActionParam} args
 */
export const downloadAudio = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "download",
    "src": args.src,
    "type": "audio",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Download the frame src.
 * @param {import("./actions.js").ActionParam} args
 */
export const downloadFrame = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "download",
    "src": args.src,
    "type": "frame",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Download the hover link.
 * @param {import("./actions.js").ActionParam} args
 */
export const downloadLink = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "download",
    "src": args.src,
    "type": "link",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Download the image src.
 * @param {import("./actions.js").ActionParam} args
 */
export const downloadImage = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "download",
    "src": args.src,
    "type": "img",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Download the video src.
 * @param {import("./actions.js").ActionParam} args
 */
export const downloadVideo = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "download",
    "src": args.src,
    "type": "video",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the audio src in a new tab.
 * @param {import("./actions.js").ActionParam} args
 */
export const newtabAudio = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "newtab",
    "src": args.src,
    "type": "audio",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the frame src in a new tab.
 * @param {import("./actions.js").ActionParam} args
 */
export const newtabFrame = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "newtab",
    "src": args.src,
    "type": "frame",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the hover link in a new tab.
 * @param {import("./actions.js").ActionParam} args
 */
export const newtabLink = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "newtab",
    "src": args.src,
    "type": "link",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the image src in a new tab.
 * @param {import("./actions.js").ActionParam} args
 */
export const newtabImage = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "newtab",
    "src": args.src,
    "type": "img",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the video src in a new tab.
 * @param {import("./actions.js").ActionParam} args
 */
export const newtabVideo = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "newtab",
    "src": args.src,
    "type": "video",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Navigate to the audio src.
 * @param {import("./actions.js").ActionParam} args
 */
export const openAudio = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "open",
    "src": args.src,
    "type": "audio",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Navigate to the frame src.
 * @param {import("./actions.js").ActionParam} args
 */
export const openFrame = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "open",
    "src": args.src,
    "type": "frame",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Navigate to the hover link.
 * @param {import("./actions.js").ActionParam} args
 */
export const openLink = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "open",
    "src": args.src,
    "type": "link",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Navigate to the image src.
 * @param {import("./actions.js").ActionParam} args
 */
export const openImage = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "open",
    "src": args.src,
    "type": "img",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Navigate to the video src.
 * @param {import("./actions.js").ActionParam} args
 */
export const openVideo = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "open",
    "src": args.src,
    "type": "video",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the audio src in an external program.
 * @param {import("./actions.js").ActionParam} args
 */
export const externalAudio = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "external",
    "src": args.src,
    "type": "audio",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the frame src in an external program.
 * @param {import("./actions.js").ActionParam} args
 */
export const externalFrame = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "external",
    "src": args.src,
    "type": "frame",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the hover link in an external program.
 * @param {import("./actions.js").ActionParam} args
 */
export const externalLink = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "external",
    "src": args.src,
    "type": "link",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the image src in an external program.
 * @param {import("./actions.js").ActionParam} args
 */
export const externalImage = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "external",
    "src": args.src,
    "type": "img",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the video src in an external program.
 * @param {import("./actions.js").ActionParam} args
 */
export const externalVideo = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "external",
    "src": args.src,
    "type": "video",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Copy the audio src to the clipboard.
 * @param {import("./actions.js").ActionParam} args
 */
export const copyAudio = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "copy",
    "src": args.src,
    "type": "audio",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Copy the frame src to the clipboard.
 * @param {import("./actions.js").ActionParam} args
 */
export const copyFrame = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "copy",
    "src": args.src,
    "type": "frame",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Copy the hover link to the clipboard.
 * @param {import("./actions.js").ActionParam} args
 */
export const copyLink = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "copy",
    "src": args.src,
    "type": "link",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Copy the image buffer data to the clipboard.
 * @param {import("./actions.js").ActionParam} args
 */
export const copyImageBuffer = args => sendToPageOrSubFrame(
    "contextmenu-data", {
        "action": "copyimage",
        "src": args.src,
        "type": "img",
        "x": zoomX(),
        "y": zoomY()
    })

/**
 * Copy the image src to the clipboard.
 * @param {import("./actions.js").ActionParam} args
 */
export const copyImage = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "copy",
    "src": args.src,
    "type": "img",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Copy the video src to the clipboard.
 * @param {import("./actions.js").ActionParam} args
 */
export const copyVideo = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "copy",
    "src": args.src,
    "type": "video",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Copy the title attribute to the clipboard.
 * @param {import("./actions.js").ActionParam} args
 */
export const copyTitleAttr = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "copy",
    "src": args.src,
    "type": "titleAttr",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Copy the page title to the clipboard.
 * @param {import("./actions.js").ActionParam} args
 */
export const copyPageTitle = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "copy",
    "src": args.src,
    "type": "linkPageTitle",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the selected text in a new split.
 * @param {import("./actions.js").ActionParam} args
 */
export const splitText = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "split",
    "src": args.src,
    "type": "text",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the selected text in a new vertical split.
 * @param {import("./actions.js").ActionParam} args
 */
export const vsplitText = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "vsplit",
    "src": args.src,
    "type": "text",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Download the selected text as if a link.
 * @param {import("./actions.js").ActionParam} args
 */
export const downloadText = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "download",
    "src": args.src,
    "type": "text",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the selected text in a new tab (either as search or url).
 * @param {import("./actions.js").ActionParam} args
 */
export const newtabText = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "newtab",
    "src": args.src,
    "type": "text",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Navigate to the selected text (either as search or url).
 * @param {import("./actions.js").ActionParam} args
 */
export const openText = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "open",
    "src": args.src,
    "type": "text",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Open the selected text in an external program.
 * @param {import("./actions.js").ActionParam} args
 */
export const externalText = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "external",
    "src": args.src,
    "type": "text",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Copy the selected text to the clipboard.
 * @param {import("./actions.js").ActionParam} args
 */
export const copyText = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "copy",
    "src": args.src,
    "type": "text",
    "x": zoomX(),
    "y": zoomY()
})

/**
 * Search the page for the selected text.
 * @param {import("./actions.js").ActionParam} args
 */
export const searchText = args => sendToPageOrSubFrame("contextmenu-data", {
    "action": "search",
    "src": args.src,
    "type": "text",
    "x": zoomX(),
    "y": zoomY()
})

/** Toggle media playback for the hovered audio/video element. */
export const toggleMediaPlay = () => sendToPageOrSubFrame(
    "action", "togglePause", X, Y)

/** Lower the volume for the hovered audio/video element. */
export const mediaDown = () => sendToPageOrSubFrame(
    "action", "volumeDown", X, Y)

/** Incease the volume for the hovered audio/video element. */
export const mediaUp = () => sendToPageOrSubFrame(
    "action", "volumeUp", X, Y)

/** Decrease the playbackRate for the hovered audio/video element. */
export const mediaSlower = () => sendToPageOrSubFrame(
    "action", "playbackDown", X, Y)

/** Increase the playbackRate for the hovered audio/video element. */
export const mediaFaster = () => sendToPageOrSubFrame(
    "action", "playbackUp", X, Y)

/** Toggle the mute state for the hovered audio/video element. */
export const toggleMediaMute = () => sendToPageOrSubFrame(
    "action", "toggleMute", X, Y)

/** Toggle the loop state for the hovered audio/video element. */
export const toggleMediaLoop = () => sendToPageOrSubFrame(
    "action", "toggleLoop", X, Y)

/** Toggle the native controls for the hovered audio/video element. */
export const toggleMediaControls = () => sendToPageOrSubFrame(
    "action", "toggleControls", X, Y)

/** Inspect the hovered element in the devtools (opens if needed). */
export const inspectElement = () => {
    const page = currentPage()
    if (page) {
        const containerPos = pageContainerPos()
        page.inspectElement(Math.round(X + containerPos.left),
            Math.round(Y + containerPos.top))
    }
}

/** Left click on the current hovered element. */
export const leftClick = () => sendToPageOrSubFrame("send-input-event",
    {"type": "click", "x": X, "y": Y})

/** Move the pointer to the top of the page including scrolling. */
export const startOfPage = async() => {
    const {scrollTop} = await import("./actions.js")
    await scrollTop()
    Y = 0
    await updateElement()
}

/** Move the pointer 100px left. */
export const moveFastLeft = async() => {
    X -= 100
    await updateElement()
}

/** Move the pointer 10px left. */
export const moveLeft = async() => {
    X -= 10
    await updateElement()
}

/** Focus an input at the pointer position (goes to insert mode if found). */
export const insertAtPosition = async() => {
    const factor = currentPage()?.getZoomFactor() ?? 1
    await sendToPageOrSubFrame("focus-input",
        {"x": X * factor, "y": Y * factor})
}

/** Move the pointer 10px down, scrolling the page as needed. */
export const moveDown = async() => {
    const page = currentPage()
    if (!page) {
        return
    }
    const {bottom, top} = pageOffset(page)
    if (Y === bottom - top - getSetting("guifontsize")) {
        const {"scrollDown": scroll} = await import("./actions.js")
        await scroll()
        listenForScroll = true
    } else {
        Y += 10
    }
    await updateElement()
}

/** Move the pointer 10px up, scrolling the page as needed. */
export const moveUp = async() => {
    if (Y === 0) {
        const {"scrollUp": scroll} = await import("./actions.js")
        await scroll()
        listenForScroll = true
    } else {
        Y -= 10
    }
    await updateElement()
}

/** Move the pointer 10px right. */
export const moveRight = async() => {
    X += 10
    await updateElement()
}

/** Right click on the current hover element. */
export const rightClick = async() => {
    await sendToPageOrSubFrame("send-input-event",
        {"button": "right", "type": "click", "x": X, "y": Y})
    const {storePointerRightClick} = await import("./contextmenu.js")
    storePointerRightClick()
}

/**
 * Open the page menu if as if right-clicked and enabled.
 * @param {import("./actions.js").ActionParam} args
 */
export const openMenu = args => sendToPageOrSubFrame("contextmenu-data",
    {"force": true, "src": args.src, "x": zoomX(), "y": zoomY()})

/** Switch to visual mode and store start location. */
export const startVisualSelect = async() => {
    if (mouseSelection && getSetting("mousevisualmode") !== "never") {
        await restoreSelection()
    } else {
        const {setMode} = await import("./modes.js")
        await setMode("visual")
        startX = Number(X)
        startY = Number(Y)
    }
}

/** Swap the current start location and the pointer while in visual mode. */
export const swapPosition = async() => {
    if (currentMode() !== "visual") {
        return
    }
    [startX, X] = [X, startX]
    ;[startY, Y] = [Y, startY]
    await updateElement()
}

/** Move the pointer 100px right. */
export const moveFastRight = async() => {
    X += 100
    await updateElement()
}

/** Move the pointer to the center of the view vertically. */
export const centerOfView = async() => {
    const page = currentPage()
    if (!page) {
        return
    }
    const {bottom, top} = pageOffset(page)
    Y = (bottom - top) / 2
    await updateElement()
}

/** Scroll 100px down at the current hover element. */
export const scrollDown = async() => {
    await sendToPageOrSubFrame("send-input-event",
        {"deltaY": -100, "type": "scroll", "x": X, "y": Y})
    await updateElement()
}

/** Scroll 100px up at the current hover element. */
export const scrollUp = async() => {
    await sendToPageOrSubFrame("send-input-event",
        {"deltaY": 100, "type": "scroll", "x": X, "y": Y})
    await updateElement()
}

/** Scroll 100px left at the current hover element. */
export const scrollLeft = async() => {
    await sendToPageOrSubFrame("send-input-event",
        {"deltaX": 100, "type": "scroll", "x": X, "y": Y})
    await updateElement()
}

/** Scroll 100px right at the current hover element. */
export const scrollRight = async() => {
    await sendToPageOrSubFrame("send-input-event",
        {"deltaX": -100, "type": "scroll", "x": X, "y": Y})
    await updateElement()
}

/** Move the pointer to the top of the view. */
export const startOfView = async() => {
    Y = 0
    await updateElement()
}

/** Move the pointer 1px left. */
export const moveSlowLeft = async() => {
    X -= 1
    await updateElement()
}

/** Move the pointer 1px down. */
export const moveSlowDown = async() => {
    Y += 1
    await updateElement()
}

/** Move the pointer 1px up. */
export const moveSlowUp = async() => {
    Y -= 1
    await updateElement()
}

/** Move the pointer 1px right. */
export const moveSlowRight = async() => {
    X += 1
    await updateElement()
}

/** Move the pointer to the end of the view. */
export const endOfView = async() => {
    Y = window.innerHeight
    await updateElement()
}

/** Move the pointer to the end of the page with scrolling. */
export const endOfPage = async() => {
    const {scrollBottom} = await import("./actions.js")
    await scrollBottom()
    Y = window.innerHeight
    await updateElement()
}

/** Move the pointer to the right of the view. */
export const moveRightMax = async() => {
    X = window.innerWidth
    await updateElement()
}

/** Move the pointer to the left of the view. */
export const moveLeftMax = async() => {
    X = 0
    await updateElement()
}

/** Move the pointer 100px down, scrolling the page as needed. */
export const moveFastDown = async() => {
    const page = currentPage()
    if (!page) {
        return
    }
    const {bottom, top} = pageOffset(page)
    if (Y === bottom - top - getSetting("guifontsize")) {
        const {"scrollDown": scroll} = await import("./actions.js")
        await scroll()
        listenForScroll = true
    } else {
        Y += 100
    }
    await updateElement()
}

/** Move the pointer 100px up, scrolling the page as needed. */
export const moveFastUp = async() => {
    if (Y === 0) {
        const {"scrollUp": scroll} = await import("./actions.js")
        await scroll()
        listenForScroll = true
    } else {
        Y -= 100
    }
    await updateElement()
}

/**
 * Store a pointer position.
 * @param {{key?: string, location?: {x: number, y: number}, path: string}} args
 */
export const storePos = async args => {
    const key = args?.key
    if (!key) {
        return
    }
    let posType = getSetting("pointerpostype")
    if (posType !== "local" && posType !== "global") {
        posType = "global"
        if (key !== key.toUpperCase()) {
            posType = "local"
        }
    }
    const qmfile = joinPath(await appData(), "quickmarks")
    /**
     * @type {import("../util.js").PartialJSON
     *   &Partial<import("./actions.js").Quickmarks>}
     */
    const qm = await readJSON(qmfile) ?? {}
    if (!("pointer" in qm) || !qm.pointer) {
        qm.pointer = {"global": {}, "local": {}}
    }
    if (args?.path === "global") {
        posType = "global"
    }
    if (posType === "local") {
        let path = ""
        const pointerPosId = getSetting("pointerposlocalid")
        if (pointerPosId === "domain") {
            path = domainName(await urlToString(currentPage()?.src ?? ""))
                || domainName(currentPage()?.src ?? "") || ""
        }
        if (pointerPosId === "url" || !path) {
            path = await urlToString(currentPage()?.src ?? "")
                || currentPage()?.src || ""
        }
        path = args?.path ?? path
        if (!qm.pointer.local[path]) {
            qm.pointer.local[path] = {}
        }
        qm.pointer.local[path][key] = args?.location
            ?? {"x": Math.round(X), "y": Math.round(Y)}
    } else {
        qm.pointer.global[key] = args?.location
            ?? {"x": Math.round(X), "y": Math.round(Y)}
    }
    await writeJSON(qmfile, qm)
}

/**
 * Restore a pointer position.
 * @param {{key?: string, path?: string}} args
 */
export const restorePos = async args => {
    const key = args?.key
    if (!key) {
        return
    }
    const pointerPosId = getSetting("pointerposlocalid")
    let path = ""
    if (pointerPosId === "domain") {
        path = domainName(await urlToString(currentPage()?.src ?? ""))
            || domainName(currentPage()?.src ?? "") || ""
    }
    if (pointerPosId === "url" || !path) {
        path = await urlToString(currentPage()?.src ?? "")
            || currentPage()?.src || ""
    }
    path = args?.path ?? path
    /**
     * @type {import("../util.js").PartialJSON
     *   &Partial<import("./actions.js").Quickmarks>}
     */
    const qm = await readJSON(joinPath(await appData(), "quickmarks")) ?? {}
    const pos = qm?.pointer?.local?.[path]?.[key] ?? qm?.pointer?.global?.[key]
    if (pos) {
        await move(pos.x, pos.y)
    }
}

/** Register mouse event listeners for context and click info. */
export const init = () => {
    ipcRenderer.on("mouse-down-location", async(_, clickInfo) => {
        const {setMode} = await import("./modes.js")
        const {resetInsertLeaveTimeout} = await import("./input.js")
        resetInsertLeaveTimeout()
        if ("ces".includes(currentMode()[0]) && getMouseConf("leaveinput")) {
            await setMode("normal")
        }
        if (clickInfo.webviewId
            && clickInfo.webviewId !== currentPage()?.getWebContentsId()) {
            const page = listReadyPages().find(
                p => p.getWebContentsId() === clickInfo.webviewId)
            if (page) {
                const tab = tabForPage(page)
                if (tab) {
                    const {switchToTab} = await import("./tabs.js")
                    await switchToTab(tab)
                }
            }
        }
        const {clear} = await import("./contextmenu.js")
        clear()
        if (["pointer", "visual"].includes(currentMode())) {
            if (currentMode() === "pointer") {
                await sendToPageOrSubFrame("action",
                    "selectionRemove", zoomX(), zoomY())
            }
            if (getMouseConf("movepointer")) {
                const factor = currentPage()?.getZoomFactor() ?? 1
                await move(clickInfo.x * factor, clickInfo.y * factor)
            } else {
                await updateElement()
            }
        }
        const {setFocusCorrectly} = await import("./actions.js")
        await setFocusCorrectly()
    })
    ipcRenderer.on("mouse-click-info", async(_, clickInfo) => {
        const {setMode} = await import("./modes.js")
        const {resetInsertLeaveTimeout} = await import("./input.js")
        resetInsertLeaveTimeout()
        if (skipNextClick) {
            skipNextClick = false
            return
        }
        if (["pointer", "visual"].includes(currentMode())) {
            await updateElement()
            return
        }
        if (clickInfo.toinsert) {
            if (getMouseConf("toinsert")) {
                await setMode("insert")
            }
        } else if ("ces".includes(currentMode()[0])
            && getMouseConf("leaveinput")) {
            await setMode("normal")
        }
        const {setFocusCorrectly} = await import("./actions.js")
        await setFocusCorrectly()
        storeMouseSelection(null)
    })
    ipcRenderer.on("mouse-selection", async(_, selectInfo) => {
        const {setMode} = await import("./modes.js")
        if (platform() === "linux" || platform().includes("bsd")) {
            ipcRenderer.invoke("write-clipboard", selectInfo.text, "selection")
                .catch(() => null)
        }
        if (selectInfo.toinsert) {
            if (getMouseConf("toinsert")) {
                await setMode("insert")
            }
            return
        }
        const switchToVisual = getSetting("mousevisualmode")
        if (switchToVisual !== "never" || currentMode() === "visual") {
            skipNextClick = true
            const factor = currentPage()?.getZoomFactor() ?? 1
            storeMouseSelection({
                "endX": selectInfo.endX * factor,
                "endY": selectInfo.endY * factor,
                "startX": selectInfo.startX * factor,
                "startY": selectInfo.startY * factor
            })
            if (switchToVisual === "activate") {
                await startVisualSelect()
            }
        }
    })
}
