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

window.addEventListener("DOMContentLoaded", async() => {
    const input = await import("./input.js")
    await input.init()
    const settings = await import("./settings.js")
    await settings.init()
    const history = await import("./history.js")
    await history.init()
    const favicons = await import("./favicons.js")
    await favicons.init()
    const modes = await import("./modes.js")
    modes.init()
    const commandhistory = await import("./commandhistory.js")
    await commandhistory.init()
    const explorehistory = await import("./explorehistory.js")
    await explorehistory.init()
    const follow = await import("./follow.js")
    follow.init()
    const contextmenu = await import("./contextmenu.js")
    contextmenu.init()
    const pointer = await import("./pointer.js")
    pointer.init()
    const tabs = await import("./tabs.js")
    await tabs.init()
})
