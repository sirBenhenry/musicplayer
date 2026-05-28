// Custom entry point — registers TrackPlayer background service before React root mounts.
// All import statements are hoisted by Metro, so use require() to enforce execution order.

const TrackPlayer = require('react-native-track-player').default;
const { PlaybackService } = require('./lib/PlaybackService');

TrackPlayer.registerPlaybackService(() => PlaybackService);

require('expo-router/entry');
