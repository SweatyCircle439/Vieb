/*
* Vieb - Vim Inspired Electron Browser
* Copyright (C) 2026 Jelmer van Arnhem
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

const safeElements = new Set([
    "#text",
    "a",
    "body",
    "br",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "kbd",
    "li",
    "ol",
    "p",
    "span",
    "ul"
])
const safeAttributes = new Set(["class", "href"])

/** Generate a very basic ID because crypto is not reliably available at all. */
const generateBasicId = () => Math.random().toString(36).slice(2)

/**
 * Filter bad elements from a node recursively.
 * @param {ChildNode} node
 */
const onlyKeepSafeNodes = node => {
    if (!safeElements.has(node.nodeName.toLowerCase())) {
        console.warn("Removed node from translations:", node)
        node.remove()
        return
    }
    if (node instanceof Element) {
        for (const attr of node.attributes) {
            if (safeAttributes.has(attr.name)) {
                continue
            }
            console.warn(
                `Removed attribute ${attr.name} from translations:`, node)
            node.removeAttribute(attr.name)
        }
    }
    for (const child of node.childNodes) {
        onlyKeepSafeNodes(child)
    }
}

/**
 * Translate a field, then parse it as HTML and return a list of safe elements.
 * @param {import("../../types/i18n.d.ts").TranslationKeys} id
 * @param {{fields?: string[], customLang?: null|string}} opts
 */
export const translateAsHTML = (
    id, {customLang = null, fields = []} = {}
) => new Promise(res => {
    const uuid = generateBasicId()
    ipcRenderer.once(`translate-query-response-${uuid}`, (_, value) => {
        const parsed = new DOMParser().parseFromString(value, "text/html")
        const body = parsed.querySelector("body")
        if (!body) {
            res([])
            return
        }
        onlyKeepSafeNodes(body)
        res([...body.childNodes])
    })
    ipcRenderer.sendToHost("translate-query",
        uuid, id, {customLang, fields})
})

/**
 * Translate a field via the renderer.
 * @param {import("../../types/i18n.d.ts").TranslationKeys} id
 * @param {{fields?: string[], customLang?: null|string}} opts
 * @returns {Promise<string>}
 * @throws {Error} When the English language file is not valid.
 */
export const translate = (
    id, {customLang = null, fields = []} = {}
) => new Promise(res => {
    const uuid = generateBasicId()
    ipcRenderer.once(`translate-query-response-${uuid}`, (_, value) => {
        res(value)
    })
    ipcRenderer.sendToHost("translate-query", uuid, id, {customLang, fields})
})

/**
 * Get the css color vars from the renderer.
 * @returns {Promise<{
 *   "bg": string,
 *   "fg": string,
 *   "linkcolor": string
 * }>}
 */
export const getColorVars = () => new Promise(res => {
    ipcRenderer.once(`css-color-query-response`, (_, value) => {
        res(value)
    })
    ipcRenderer.sendToHost("css-color-query")
})

/**
 * @typedef {typeof import("../renderer/settings.js").defaultSettings} setting
 */

/**
 * Get a setting via ipc from the renderer.
 * @template {keyof setting} T Valid setting names.
 * @param {T} set
 * @returns {Promise<setting[T]>}
 */
export const getSetting = set => new Promise(res => {
    ipcRenderer.once(`setting-query-response-${set}`, (_, value) => {
        res(value)
    })
    ipcRenderer.sendToHost("setting-query", set)
})

/**
 * Send a notification to the renderer thread.
 * @param {import("../renderer/util.js").NotificationInfo} opts
 */
export const notify = opts => ipcRenderer.sendToHost("notify", opts)

/**
 * Detect if an element can be scrolled.
 * @param {Element} el
 */
export const canScroll = el => {
    const hasY = el.scrollHeight > el.clientHeight
    const hasX = el.scrollWidth > el.clientWidth
    if (!hasX && !hasY) {
        return false
    }
    const styles = el.computedStyleMap()
    const canY = hasY && ["auto", "scroll"].includes(
        styles.get("overflow-y")?.toString() ?? "")
    const canX = hasX && ["auto", "scroll"].includes(
        styles.get("overflow-x")?.toString() ?? "")
    return canX || canY
}
