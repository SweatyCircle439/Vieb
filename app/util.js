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

import fs from "node:fs"
import {homedir, platform} from "node:os"
import path from "node:path"
import {normalize} from "node:path/posix"
import rimraf from "./rimraf.js"

/**
 * @typedef {"cookies"|"downloads"|"help"
 *   |"history"|"newtab"|"notifications"|"version"} SpecialPage
 */
/** @type {Set<SpecialPage>} */
const specialPages = new Set([
    "cookies",
    "downloads",
    "help",
    "history",
    "newtab",
    "notifications",
    "version"
])
let appDataPath = ""
let appRootDirPath = ""
/**
 * @type {{
 *   appdata: string,
 *   autoplay: string,
 *   downloads: string,
 *   icon?: string,
 *   name: string,
 *   order: "none"|"user-only"|"datafolder-only"
 *     |"user-first"|"datafolder-first",
 *   override: string,
 *   files: string[],
 *   config: string
 *   versions: {
 *     app: string,
 *     chrome: string,
 *     electron: string
 *   }
 * }?}
 */
let configSettings = null
/** @type {Map<Element|ShadowRoot, {x: number, y: number}>} */
const framePaddingInfo = new Map()

export const specialChars = /[\s!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~’”、。！：；-]/gi

export const specialCharsAllowSpaces = /[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~’”、。！：；-]/gi

/**
 * Join multiple path parts into a single resolved path.
 * @param {string[]} paths
 */
export const joinPath = (...paths) => path.resolve(path.join(...paths))

/**
 * Expand a path that is prefixed with ~ to the user's home folder.
 * @param {string} loc
 */
export const expandPath = loc => {
    if (loc.startsWith("~")) {
        return loc.replace("~", homedir())
    }
    return loc
}

/**
 * Check if a path exists.
 * @param {string} loc
 */
export const pathExists = loc => {
    try {
        return fs.existsSync(loc)
    } catch {
        return false
    }
}

/** Get the root app directory from any location. */
export const getAppRootDir = () => {
    if (!appRootDirPath) {
        let current = import.meta.dirname
        let tries = 0
        while (!pathExists(joinPath(current, "package.json")) && tries < 100) {
            current = joinPath(current, "..")
            tries += 1
        }
        if (tries === 100) {
            appRootDirPath = import.meta.dirname
        } else {
            appRootDirPath = joinPath(current, "app")
        }
    }
    return appRootDirPath
}

/** Returns the app configuration settings. */
export const appConfig = async() => {
    if (!configSettings) {
        const {ipcRenderer} = await import("electron")
        configSettings = await ipcRenderer.invoke("app-config")
        if (!configSettings) {
            return null
        }
        let files = [configSettings.override]
        const datafolderConfig = joinPath(configSettings.appdata, "viebrc")
        const userFirstConfig = expandPath("~/.vieb/viebrc")
        const userGlobalConfig = expandPath("~/.viebrc")
        if (!configSettings.override) {
            if (configSettings.order === "user-only") {
                files = [userGlobalConfig, userFirstConfig]
            }
            if (configSettings.order === "datafolder-only") {
                files = [datafolderConfig]
            }
            if (configSettings.order === "user-first") {
                files = [userGlobalConfig, userFirstConfig, datafolderConfig]
            }
            if (configSettings.order === "datafolder-first") {
                files = [datafolderConfig, userFirstConfig, userGlobalConfig]
            }
        }
        configSettings.files = files
        configSettings.config = configSettings.override || datafolderConfig
    }
    return configSettings
}

/** Returns the appdata path (works from both main, renderer and preloads). */
export const appData = async() => {
    if (!appDataPath) {
        try {
            const {app} = await import("electron")
            return app.getPath("appData")
        } catch {
            // Not in main thread
        }
        const config = await appConfig()
        appDataPath = config?.appdata ?? ""
    }
    return appDataPath
}

/**
 * @typedef {string|number|boolean|null|PartialJSONArray|PartialJSONObject}
 * PartialJSON
 */
/** @typedef {Array<PartialJSON>} PartialJSONArray */
/** @typedef {{[key: string]: (PartialJSON|undefined)}} PartialJSONObject */

/**
 * Read the file contents of a file and parse it as JSON.
 * @param {string} loc
 * @returns {PartialJSON|null}
 */
export const readJSONSync = loc => {
    try {
        return JSON.parse(fs.readFileSync(loc).toString())
    } catch {
        return null
    }
}

/**
 * Read the file contents of a file and parse it as JSON.
 * @param {string} loc
 * @returns {Promise<PartialJSON|null>}
 */
export const readJSON = loc => new Promise(res => {
    fs.readFile(loc, (err, data) => {
        if (err) {
            res(null)
            return
        }
        try {
            res(JSON.parse(data.toString()))
        } catch {
            res(null)
        }
    })
})

/**
 * Return the resolved system that should be exposed via useragent.
 * @param {string} useragentsys
 */
export const userAgentResolvedSystem = async(useragentsys = "auto") => {
    let desired = useragentsys ?? "auto"
    if (desired === "auto") {
        try {
            const {getSetting} = await import("./renderer/settings.js")
            desired = getSetting("useragentsys")
        } catch {
            // Fall back to auto
        }
    }
    const current = platform()
    if (desired === "auto" && current === "win32" || desired === "windows") {
        return "windows"
    }
    if (desired === "auto" && current === "darwin" || desired === "mac") {
        return "mac"
    }
    return "linux"
}

/**
 * Return per operating system the result of navigator.platform.
 * @param {string} useragentsys
 */
export const userAgentPlatform = async(useragentsys = "auto") => ({
    "linux": "X11; Linux x86_64",
    "mac": "Macintosh; Intel Mac OS X 10_15_7",
    "windows": "Windows NT 10.0; Win64; x64"
}[await userAgentResolvedSystem(useragentsys)])

/** Return the default navigator.userAgent. */
export const defaultUseragent = async() => {
    let fullversion = typeof process !== "undefined" && process?.versions.chrome
    if (!fullversion) {
        const conf = await appConfig()
        fullversion = conf?.versions.chrome ?? ""
    }
    const version = `${fullversion.split(".", 1)[0]}.0.0.0`
    const sys = await userAgentPlatform()
    return `Mozilla/5.0 (${sys}) AppleWebKit/537.36 (KHTML, like Gecko) `
        + `Chrome/${version} Safari/537.36`
}

/** Calculate the current Firefox version based on date & release schedule. */
const firefoxVersion = () => {
    const daysSinceBase = (Date.now()
        - new Date(2023, 4, 9).getTime()) / 86400000
    return `${113 + Math.floor(daysSinceBase / 28)}.0`
}

/** Return the Firefox navigator.userAgent. */
export const firefoxUseragent = async() => {
    const ver = firefoxVersion()
    const sys = await userAgentPlatform()
    return `Mozilla/5.0 (${sys}; rv:${ver}) Gecko/20100101 Firefox/${ver}`
}

/**
 * Template a user agent with value with version and browser info.
 * @param {string} agent
 */
export const userAgentTemplated = async agent => {
    if (!agent) {
        return ""
    }
    let fullversion = typeof process !== "undefined" && process?.versions.chrome
    if (!fullversion) {
        const conf = await appConfig()
        fullversion = conf?.versions.chrome ?? ""
    }
    const version = `${fullversion.split(".", 1)[0]}.0.0.0`
    return agent
        .replace(/%sys/g, await userAgentPlatform())
        .replace(/%firefoxversion/g, firefoxVersion())
        .replace(/%fullversion/g, fullversion)
        .replace(/%version/g, version)
        .replace(/%firefox/g, await firefoxUseragent())
        .replace(/%default/g, await defaultUseragent())
}

/**
 * Return the domain name for the provided url.
 * @param {string} url
 */
export const domainName = url => {
    try {
        const {hostname} = new URL(url)
        if (hostname.endsWith("localhost") || /^(\d|\.)+$/.test(hostname)) {
            return hostname
        }
        return hostname.replace(/(?:[\dA-Za-z]+\.)+(\w+\.\w+)/, "$1")
    } catch {
        return null
    }
}

/**
 * Returns true if both urls share the same domain name, else false.
 * @param {string} url1
 * @param {string} url2
 */
export const sameDomain = (url1, url2) => {
    const domain1 = domainName(url1)
    const domain2 = domainName(url2)
    return domain1 && domain2 && domain1 === domain2 && true || false
}

/**
 * Format a provided date, unix time or.
 * @param {string|number|Date|null|undefined} dateStringOrNumber
 */
export const formatDate = dateStringOrNumber => {
    let date = new Date(dateStringOrNumber ?? "")
    if (typeof dateStringOrNumber === "number") {
        date = new Date(dateStringOrNumber * 1000)
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")
    }-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours())
        .padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${
        String(date.getSeconds()).padStart(2, "0")}`
}

/**
 * Store the location of a frame element.
 * @param {Element|ShadowRoot|null} element
 * @param {{x: number, y: number}} location
 */
const storeFrameInfo = (element, location) => element
    && framePaddingInfo.set(element, location) && null

/**
 * Find the frame info for a given element if available.
 * @param {Element|ShadowRoot|null} el
 */
export const findFrameInfo = el => el && framePaddingInfo.get(el)

/**
 * Get a CSS decleration property from an element as a number of pixels.
 * @param {Element|CSSStyleDeclaration} element
 * @param {string} prop
 */
export const propPixels = (element, prop) => {
    let value = ""
    if (element instanceof CSSStyleDeclaration) {
        value = element.getPropertyValue(prop)
    } else {
        value = element.computedStyleMap().get(prop)?.toString() ?? ""
    }
    if (typeof value === "number") {
        return value
    }
    if (value?.endsWith("px")) {
        return Number(value.replace("px", "")) || 0
    }
    if (value?.endsWith("em")) {
        const elementFontSize = Number(document.body.computedStyleMap().get(
            "font-size")?.toString()?.replace("px", "") || 0)
        return Number(value.replace("em", "")) * elementFontSize || 0
    }
    return Number(value) || 0
}

/**
 * Get the position of a given element based on bounding rect plus padding.
 * @param {Element} frame
 */
export const framePosition = frame => ({
    "x": frame.getBoundingClientRect().x + propPixels(frame, "padding-left")
        + propPixels(frame, "border-left-width"),
    "y": frame.getBoundingClientRect().y + propPixels(frame, "padding-top")
        + propPixels(frame, "border-top-width")
})

/**
 * Check if anything inside a JSON structure is an object.
 * @param {import("./util.js").PartialJSON|undefined} o
 * @returns {o is import("./util.js").PartialJSONObject}
 */
export const isObject = o => o && typeof o === "object"
    && !Array.isArray(o) || false

/** @typedef {string|{[property: string]: StringOrObject}} StringOrObject */

/**
 * Check if an object only has string values, possibly nested in sub objects.
 * @param {import("./util.js").PartialJSON|undefined} item
 * @returns {item is {[property: string]: string}}
 */
export const isFlatStringObject = item => isObject(item)
    && Object.values(item).every(v => typeof v === "string")

/**
 * Check if an object only has string values, possibly nested in sub objects.
 * @param {import("./util.js").PartialJSON|undefined} item
 * @returns {item is StringOrObject}
 */
export const isNestedStringObject = item => {
    if (isObject(item)) {
        return Object.values(item).every(v => isNestedStringObject(v))
    }
    return typeof item === "string"
}

/**
 * Check if a node is an element, taking subframes into account.
 * @param {Node|EventTarget|null|undefined} el
 * @returns {el is Element}
 */
export const isElement = el => {
    if (el instanceof EventTarget && !(el instanceof Element)) {
        return false
    }
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
        return false
    }
    return el instanceof el.ownerDocument.defaultView.Element
}

/**
 * Check if a node is an html element, taking subframes into account.
 * @param {Node|EventTarget|null|undefined} el
 * @returns {el is HTMLElement}
 */
export const isHTMLElement = el => {
    if (el instanceof EventTarget && !(el instanceof HTMLElement)) {
        return false
    }
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
        return false
    }
    return el instanceof el.ownerDocument.defaultView.HTMLElement
}

/**
 * Check if a node is an iframe element, taking subframes into account.
 * @param {Node|EventTarget|null|undefined} el
 * @returns {el is HTMLIFrameElement}
 */
export const isHTMLIFrameElement = el => {
    if (el instanceof EventTarget && !(el instanceof HTMLIFrameElement)) {
        return false
    }
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
        return false
    }
    return el instanceof el.ownerDocument.defaultView.HTMLIFrameElement
}

/**
 * Check if a node is an input or textarea, taking subframes into account.
 * @param {Node|EventTarget|null|undefined} el
 * @returns {el is HTMLInputElement|HTMLTextAreaElement}
 */
export const isInputOrTextElement = el => {
    if (el instanceof EventTarget && (
        !(el instanceof HTMLInputElement)
        && !(el instanceof HTMLTextAreaElement)
    )) {
        return false
    }
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
        return false
    }
    return el instanceof el.ownerDocument.defaultView.HTMLInputElement
        || el instanceof el.ownerDocument.defaultView.HTMLTextAreaElement
}

/**
 * Check if a node is an anchor element, taking subframes into account.
 * @param {Node|EventTarget|null|undefined} el
 * @returns {el is HTMLAnchorElement}
 */
export const isHTMLAnchorElement = el => {
    if (el instanceof EventTarget && !(el instanceof HTMLAnchorElement)) {
        return false
    }
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
        return false
    }
    return el instanceof el.ownerDocument.defaultView.HTMLAnchorElement
}

/**
 * Check if a node is a link element, taking subframes into account.
 * @param {Node|EventTarget|null|undefined} el
 * @returns {el is HTMLLinkElement}
 */
export const isHTMLLinkElement = el => {
    if (el instanceof EventTarget && !(el instanceof HTMLLinkElement)) {
        return false
    }
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
        return false
    }
    return el instanceof el.ownerDocument.defaultView.HTMLLinkElement
}

/**
 * Check if a node is an image element, taking subframes into account.
 * @param {Node|EventTarget|null|undefined} el
 * @returns {el is HTMLImageElement}
 */
export const isHTMLImageElement = el => {
    if (el instanceof EventTarget && !(el instanceof HTMLImageElement)) {
        return false
    }
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
        return false
    }
    return el instanceof el.ownerDocument.defaultView.HTMLImageElement
}

/**
 * Check if a node is an svg element, taking subframes into account.
 * @param {Node|EventTarget|null|undefined} el
 * @returns {el is SVGElement}
 */
export const isSVGElement = el => {
    if (el instanceof EventTarget && !(el instanceof SVGElement)) {
        return false
    }
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
        return false
    }
    return el instanceof el.ownerDocument.defaultView.SVGElement
}

/**
 * Check if a node is a video element, taking subframes into account.
 * @param {Node|EventTarget|null|undefined} el
 * @returns {el is HTMLVideoElement}
 */
export const isHTMLVideoElement = el => {
    if (el instanceof EventTarget && !(el instanceof HTMLVideoElement)) {
        return false
    }
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
        return false
    }
    return el instanceof el.ownerDocument.defaultView.HTMLVideoElement
}

/**
 * Check if a node is an audio element, taking subframes into account.
 * @param {Node|EventTarget|null|undefined} el
 * @returns {el is HTMLAudioElement}
 */
export const isHTMLAudioElement = el => {
    if (el instanceof EventTarget && !(el instanceof HTMLAudioElement)) {
        return false
    }
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
        return false
    }
    return el instanceof el.ownerDocument.defaultView.HTMLAudioElement
}

/**
 * Call an element matches in a safe wrapper as not all elements work.
 * @param {Element|null|undefined} el
 * @param {string} query
 */
export const matchesQuery = (el, query) => {
    try {
        return el?.matches(query) ?? false
    } catch {
        // Not all elements with the 'matches' attribute have it as a function
        // Therefore we just try to call it as one, and return false otherwise
        return false
    }
}

/**
 * Find the deepest element at a position, including subframes and shadow doms.
 * @param {number} x
 * @param {number} y
 * @param {(Document|ShadowRoot)[]} levels
 * @param {number} px
 * @param {number} py
 * @returns {Element|null}
 */
export const findElementAtPosition = (
    x, y, levels = [document], px = 0, py = 0
) => {
    // Find out which element is located at a given position.
    // Will look inside subframes recursively at the corrected position.
    const elAtPos = levels?.[0]?.elementFromPoint(x - px, y - py)
    if (elAtPos?.shadowRoot && levels.includes(elAtPos.shadowRoot)) {
        return elAtPos
    }
    if (elAtPos instanceof HTMLIFrameElement && elAtPos.contentDocument) {
        const frameInfo = findFrameInfo(elAtPos)
        return findElementAtPosition(x, y,
            [elAtPos.contentDocument, ...levels], frameInfo?.x, frameInfo?.y)
    }
    if (elAtPos?.shadowRoot) {
        const frameInfo = findFrameInfo(elAtPos.shadowRoot)
        return findElementAtPosition(x, y,
            [elAtPos.shadowRoot, ...levels], frameInfo?.x, frameInfo?.y)
    }
    return elAtPos
}

/**
 * Queryselector that recursively navigates subframes and shadow doms.
 * @param {string} sel
 * @param {Document|ShadowRoot|Element} base
 * @param {number} paddedX
 * @param {number} paddedY
 */
export const querySelectorAll = (
    sel, base = document, paddedX = 0, paddedY = 0
) => {
    if (!base) {
        return []
    }
    /** @type {Element[]} */
    let elements = []
    if (base === document) {
        elements = [...base.querySelectorAll(sel) || []]
    }
    for (const element of [...base.querySelectorAll("*") || []]
        .filter(el => el.shadowRoot || el instanceof HTMLIFrameElement)) {
        let location = {"x": paddedX, "y": paddedY}
        if (!element.shadowRoot) {
            const {"x": frameX, "y": frameY} = framePosition(element)
            location = {"x": frameX + paddedX, "y": frameY + paddedY}
        }
        storeFrameInfo(element?.shadowRoot || element, location)
        if (element instanceof HTMLIFrameElement && element.contentDocument) {
            const extra = [...element.contentDocument
                .querySelectorAll(sel) || []]
            for (const e of extra) {
                storeFrameInfo(e, location)
            }
            elements = [...elements, ...extra, ...querySelectorAll(sel,
                element.contentDocument, location.x, location.y)]
        }
        if (element.shadowRoot) {
            const extra = [...element.shadowRoot
                .querySelectorAll(sel) || []]
            for (const e of extra) {
                storeFrameInfo(e, location)
            }
            elements = [...elements, ...extra, ...querySelectorAll(sel,
                element.shadowRoot, location.x, location.y)]
        }
    }
    return elements
}

/**
 * @typedef {{
 * bottom: number
 * height: number
 * left: number
 * right: number
 * top: number
 * width: number
 * x: number
 * y: number
 * }} DOMRectJSON
 */

/**
 * Find the center of a rect within the borders of the visible window.
 * @param {DOMRectJSON} rect
 */
const correctedCenterAndSizeOfRect = rect => {
    let {x, y} = rect
    const {left, top} = rect
    x ||= left
    y ||= top
    let width = Math.min(rect.width, window.innerWidth - x)
    if (x < 0) {
        width += x
        x = 0
    }
    let height = Math.min(rect.height, window.innerHeight - y)
    if (y < 0) {
        height += y
        y = 0
    }
    const centerX = x + width / 2
    const centerY = y + height / 2
    return {centerX, centerY, height, width, x, y}
}

/**
 * Return the most suitable click area given a list of options if available.
 * @param {Element} element
 * @param {DOMRectJSON[]} rects
 */
export const findClickPosition = (element, rects) => {
    let dims = {"height": 0, "width": 0, "x": 0, "y": 0}
    let clickable = false
    for (const rect of rects) {
        const {
            centerX, centerY, height, width, x, y
        } = correctedCenterAndSizeOfRect(rect)
        if (!clickable || width * height > dims.width * dims.height) {
            const elAtPos = findElementAtPosition(centerX, centerY)
            if (element === elAtPos || element?.contains(elAtPos)) {
                clickable = true
                dims = {height, width, x, y}
            }
        }
    }
    if (!clickable) {
        for (const rect of element.getClientRects()) {
            const {
                centerX, centerY, height, width, x, y
            } = correctedCenterAndSizeOfRect(rect)
            if (!clickable || width * height > dims.width * dims.height) {
                const elAtPos = findElementAtPosition(centerX, centerY)
                if (element === elAtPos || element?.contains(elAtPos)) {
                    clickable = true
                    dims = {height, width, x, y}
                }
            }
        }
    }
    return {clickable, dims}
}

/** Find the current active element, also inside shadow dom or subframes. */
export const activeElement = () => {
    if (document.activeElement?.shadowRoot) {
        let el = document.activeElement
        while (el?.shadowRoot?.activeElement) {
            el = el.shadowRoot.activeElement
        }
        return el
    }
    if (document.activeElement !== document.body
        && !(document.activeElement instanceof HTMLIFrameElement)) {
        return document.activeElement
    }
    return querySelectorAll("iframe").map(frame => {
        if (!(frame instanceof HTMLIFrameElement)) {
            return null
        }
        const doc = frame.contentDocument
        if (!doc) {
            return null
        }
        if (doc.activeElement?.shadowRoot) {
            let el = doc.activeElement
            while (el?.shadowRoot?.activeElement) {
                el = el.shadowRoot.activeElement
            }
            return el
        }
        if (doc.body !== doc.activeElement
            && !(document.activeElement instanceof HTMLIFrameElement)) {
            return doc.activeElement
        }
        return null
    }).find(Boolean)
}

/**
 * Format any number of bytes to a value with a nice unit.
 * @param {number} size
 */
export const formatSize = size => {
    const exp = Math.min(Math.floor(Math.log(size) / Math.log(1024)), 10)
    const unit = (size / 1024 ** exp || 0).toFixed(2).replace(/\.?0+$/g, "")
    return `${unit} ${" KMGTPEZYRQ"[exp]?.trim() ?? ""}B`
}

/**
 * Compare two version numbers and return which one is newer.
 * @param {string} v1Str
 * @param {string} v2Str
 */
export const compareVersions = (v1Str, v2Str) => {
    const v1 = v1Str.replace(/^v/g, "").trim()
    const v2 = v2Str.replace(/^v/g, "").trim()
    if (v1 === v2) {
        return "even"
    }
    const [v1num, v1ext] = v1.split("-", 2)
    const [v2num, v2ext] = v2.split("-", 2)
    // Same number and at least one of them has a suffix such as "-dev"
    if (v1num === v2num) {
        if (v1ext && v2ext) {
            // Do a simple comparison of named pre releases
            /** @type {{[ext: string]: number|undefined}} */
            const suffixMap = {"alpha": 2, "beta": 3, "dev": 1, "prerelease": 4}
            const v1suffix = suffixMap[v1ext] ?? 0
            const v2suffix = suffixMap[v2ext] || 0
            if (v1suffix > v2suffix) {
                return "newer"
            }
            if (v1suffix < v2suffix) {
                return "older"
            }
        } else if (v1ext) {
            return "older"
        } else if (v2ext) {
            return "newer"
        }
        return "even"
    }
    for (let i = 0; i < 3; i++) {
        if (Number(v1num.split(".")[i]) > Number(v2num.split(".")[i])) {
            return "newer"
        }
        if (Number(v1num.split(".")[i]) < Number(v2num.split(".")[i])) {
            return "older"
        }
    }
    return "unknown"
}

/**
 * Fetch any url with the Node.JS http and https modules.
 * @param {string} url
 * @param {import("https").RequestOptions} opts
 * @param {string|null} body
 */
export const fetchUrl = (
    url, opts = {}, body = null
) => new Promise((res, rej) => {
    let requestModule = null
    if (url.startsWith("https://")) {
        requestModule = import("node:https")
    } else if (url.startsWith("http://")) {
        requestModule = import("node:http")
    } else {
        rej(new Error("invalid protocol"))
        return
    }
    requestModule.then(v => v.request(url, opts, response => {
        let data = ""
        response.on("data", chunk => {
            data += chunk.toString()
        })
        response.on("end", () => {
            try {
                res(data)
            } catch(error) {
                rej(new Error(`${error}: ${data}`))
            }
        })
    })).then(v => v.on("error", err => rej(err))).then(v => {
        if (body) {
            v.write(body)
        }
        v.end()
    }).catch(rej)
})

/**
 * Fetch any url with the Node.JS http and https modules and parse its JSON.
 * @param {string} url
 * @param {import("https").RequestOptions} opts
 * @param {string|null} body
 */
export const fetchJSON = (
    url, opts = {}, body = null
) => new Promise((res, rej) => {
    fetchUrl(url, opts, body).then(data => {
        try {
            res(JSON.parse(data))
        } catch {
            rej(new Error(`Response is not valid JSON: ${data}`))
        }
    }).catch(rej)
})

/**
 * Return the last part of the path, usually the filename.
 * @param {string} loc
 */
export const basePath = loc => path.basename(loc)

/**
 * Return the directory name of the path.
 * @param {string} loc
 */
export const dirname = loc => path.dirname(loc)

/**
 * Check if a path is absolute or not.
 * @param {string} loc
 */
export const isAbsolutePath = loc => path.isAbsolute(loc)

/**
 * Check if a path is a directory.
 * @param {string} loc
 */
export const isDir = loc => {
    try {
        return fs.statSync(loc).isDirectory()
    } catch {
        return false
    }
}

/**
 * Check if a path is a file.
 * @param {string} loc
 */
export const isFile = loc => {
    try {
        return fs.statSync(loc).isFile()
    } catch {
        return false
    }
}

/**
 * Read the file contents of a file as a string.
 * @param {string} loc
 * @returns {Promise<string|null>}
 */
export const readFile = loc => new Promise(res => {
    fs.readFile(loc, (err, data) => {
        if (err) {
            res(null)
            return
        }
        res(data.toString())
    })
})

/**
 * Write data to a file.
 * @param {string} loc
 * @param {string|Buffer} data
 * @returns {Promise<boolean>} True if successful.
 */
export const writeFile = (loc, data) => new Promise(res => {
    fs.writeFile(loc, data, err => {
        if (err) {
            res(false)
            return
        }
        res(true)
    })
})

/**
 * Append data to a file.
 * @param {string} loc
 * @param {string|Buffer} data
 * @returns {Promise<boolean>} True if successful.
 */
export const appendFile = (loc, data) => new Promise(res => {
    fs.appendFile(loc, data, err => {
        if (err) {
            res(false)
            return
        }
        res(true)
    })
})

/**
 * Write JSON data async to a file, optionally with indentation and replacer.
 * @param {string} loc
 * @param {unknown} data
 * @param {{
 *   replacer?: undefined|((this: unknown, key: string, val: string) => string),
 *   indent?: number|undefined
 * }} opts
 * @returns {Promise<boolean>} True if successful.
 */
export const writeJSON = (loc, data, opts = {}) => new Promise(res => {
    fs.writeFile(loc, JSON.stringify(data, opts.replacer, opts.indent), err => {
        if (err) {
            res(false)
            return
        }
        res(true)
    })
})

/**
 * Delete a file at a location, returns success state.
 * @param {string} loc
 */
export const deleteFile = loc => {
    try {
        fs.unlinkSync(loc)
        return true
    } catch {
        // Usually permission errors, return value will be false
    }
    return false
}

/**
 * Make a directory at a location, returns success state.
 * @param {string} loc
 */
export const makeDir = loc => {
    try {
        fs.mkdirSync(loc, {"recursive": true})
        return true
    } catch {
        // Usually permission errors, return value will be false
    }
    return false
}

/**
 * List all files (or only dirs) in a folder (not recursive).
 * @param {string} loc
 * @param {boolean} absolute
 * @param {boolean} dirsOnly
 */
export const listDirSync = (loc, absolute = false, dirsOnly = false) => {
    try {
        let files = fs.readdirSync(loc)
        if (dirsOnly) {
            files = files.filter(f => isDir(joinPath(loc, f)))
        }
        if (absolute) {
            files = files.map(f => joinPath(loc, f))
        }
        return files
    } catch {
        return []
    }
}

/**
 * List all files in a folder async.
 * @param {string} loc
 * @param {boolean} absolute
 * @param {boolean} dirsOnly
 * @returns {Promise<string[]>}
 */
export const listDir = (
    loc, absolute = false, dirsOnly = false
) => new Promise(res => {
    fs.readdir(loc, (err, files) => {
        if (err) {
            res([])
            return
        }
        let parsedFiles = files
        if (dirsOnly) {
            parsedFiles = parsedFiles.filter(f => isDir(joinPath(loc, f)))
        }
        if (absolute) {
            parsedFiles = parsedFiles.map(f => joinPath(loc, f))
        }
        res(parsedFiles)
    })
})

/**
 * Watch a specific file including the polling fallback of 500ms.
 * @param {string} file
 * @param {(info: import("fs").Stats, oldInfo: import("fs").Stats) => void} call
 */
export const watchFile = (file, call) => fs.watchFile(
    file, {"interval": 500}, call)

/**
 * Get the modified date for a file location.
 * @param {string} loc
 */
export const modifiedAt = loc => {
    try {
        return fs.statSync(loc).mtime
    } catch {
        return new Date("1970-01-01")
    }
}

/**
 * Remove a location using "rm -rf" rimraf module.
 * @param {string} f
 */
export const rm = f => {
    try {
        rimraf(f)
    } catch {
        // Windows permission errors
    }
}

/**
 * Checks if a given page is a special page.
 * @param {string} page
 * @returns {page is SpecialPage}
 */
// @ts-expect-error Page is tested to be a special page or not, hence an error.
const isSpecialPage = page => specialPages.has(page)

/**
 * Get the url of a special page given a name and an optional section.
 * @param {string} userPage
 * @param {string|null} section
 * @param {boolean} skipExistCheck
 */
export const specialPagePath = (
    userPage, section = null, skipExistCheck = false
) => {
    let page = userPage
    if (!isSpecialPage(userPage) && !skipExistCheck) {
        page = "help"
    }
    const url = joinPath(getAppRootDir(), `pages/${page}.html`)
        .replace(/\\/g, "/").replace(/^\/*/g, "")
    if (section) {
        if (section.startsWith("#")) {
            return `file:///${url}${section}`
        }
        return `file:///${url}#${section}`
    }
    return `file:///${url}`
}

/**
 * Convert any url/path to the name and section of a special page if relevant.
 * @param {string} urlPath
 * @returns {{name: SpecialPage, section: string}|null}
 */
export const pathToSpecialPageName = urlPath => {
    if (urlPath?.startsWith?.("vieb://")) {
        const parts = urlPath.replace("vieb://", "").split("#")
        const [partName] = parts
        /** @type {SpecialPage} */
        let name = "help"
        if (isSpecialPage(partName)) {
            name = partName
        }
        return {
            name, "section": decodeURIComponent(parts.slice(1).join("#") || "")
        }
    }
    if (urlPath?.startsWith?.("file://")) {
        for (const page of specialPages) {
            const specialPage = specialPagePath(page).replace(/^file:\/+/g, "")
            const normalizedUrl = normalize(urlPath.replace(/^file:\/+/g, ""))
            if (normalizedUrl.startsWith(specialPage)) {
                return {
                    "name": page,
                    "section": decodeURIComponent(
                        urlPath.split("#").slice(1).join("#"))
                }
            }
            try {
                const decodedPath = decodeURI(urlPath)
                const decodedNormalizedUrl = normalize(
                    decodedPath.replace(/^file:\/+/g, ""))
                if (decodedNormalizedUrl.startsWith(specialPage)) {
                    return {
                        "name": page,
                        "section": decodeURIComponent(
                            urlPath.split("#").slice(1).join("#"))
                    }
                }
            } catch {
                // Invalid url
            }
        }
    }
    if (urlPath === "") {
        return {"name": "newtab", "section": ""}
    }
    const appImagePathPattern = new RegExp(
        "^file:///tmp/[.]mount_Vieb[a-zA-Z0-9-]+"
        + "/resources/app[.]asar/app/pages/")
    if (appImagePathPattern.test(urlPath)) {
        const name = urlPath.replace(appImagePathPattern, "").replace(/\..+/, "")
        if (isSpecialPage(name)) {
            return {name, "section": ""}
        }
    }
    return null
}

/**
 * Translate a valid url to the explore mode input representation.
 * @param {string} url
 */
export const urlToString = async url => {
    const special = pathToSpecialPageName(url)
    if (special?.name) {
        const config = await appConfig()
        let specialUrl = `${config?.name.toLowerCase()}://${special.name}`
        if (special.section) {
            specialUrl += `#${special.section}`
        }
        return specialUrl
    }
    try {
        const decoded = decodeURI(url)
        let fileName = decoded.replace(/^file:\/+/, "/")
        if (platform() === "win32") {
            fileName = decoded.replace(/^file:\/+/, "")
        }
        fileName = fileName.replace(/%23/g, "#").replace(/%3F/g, "?")
        if (isDir(fileName) || isFile(fileName)) {
            return fileName
        }
        return decoded
    } catch {
        // Invalid url
    }
    return url
}
