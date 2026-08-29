const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Bundle MathJax's tex-svg build as a plain asset (not parsed as JS) so the
// math WebViews can load it from disk instead of a CDN — see
// src/services/mathjax-source.ts.
config.resolver.assetExts.push("txt");

module.exports = config;
