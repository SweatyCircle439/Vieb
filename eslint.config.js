"use strict"

import {"default": eslintConfig, JS} from "eslint-config"

eslintConfig[JS].rules["n/global-require"] = "off"
eslintConfig[JS].rules["unicorn/prefer-module"] = "off"
eslintConfig[JS].rules["unicorn/prefer-top-level-await"] = "off"

module.exports = eslintConfig
