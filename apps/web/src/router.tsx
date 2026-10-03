import { navigation } from './app.js';
export const routes = navigation.map((label) => ({ label, path: `/${label.toLowerCase().replaceAll(' ', '-')}` }));
