const state = {
  currentUser: null,
  storeSettings: null,
  currentRoute: 'dashboard',
  routeParams: {}
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setUser(user) {
  state.currentUser = user;
  notify();
}

export function setStoreSettings(settings) {
  state.storeSettings = settings;
  notify();
}

export function setRoute(route, params = {}) {
  state.currentRoute = route;
  state.routeParams = params;
  notify();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) {
    listener(state);
  }
}

export default {
  getState,
  setUser,
  setStoreSettings,
  setRoute,
  subscribe
};
