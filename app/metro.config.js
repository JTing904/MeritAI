// Metro config: also watch ../shared so the app can import types and pure logic shared with the server.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../shared')];

// Ignore the generated native projects: a Gradle build writes thousands of files under android/,
// which floods Metro's file watcher (it hung twice after `expo prebuild` + `gradlew`).
const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nativeDirs = ['android', 'ios'].map((dir) => new RegExp(`^${escape(path.resolve(__dirname, dir))}[\\\\/].*`));
config.resolver.blockList = [...[].concat(config.resolver.blockList ?? []), ...nativeDirs];

module.exports = config;
