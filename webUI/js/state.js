import { create } from 'zustand'

const useAppState = create((set) => ({
  navigation: [],
  selectedItems: [],

  subNavigation: [],

  setInitialNavigation(nav) {
    set((state) => ({navigation: nav}));
  },

  setInitialSubNavigation(nav) {
    set((state) => ({subNavigation: nav}));
  },

  navigateFolder(item) {
    set((state) => {
      let _nav = state.navigation.slice(0);
      const index = _nav.findIndex(i => i.id === item.id);
      if (index > -1){
        _nav = _nav.slice(0, index + 1);
      } else {
        _nav.push(item);
      }
      return {navigation: _nav};
    })
  },

  subNavigateFolder(item) {
    set((state) => {
      let _nav = state.subNavigation.slice(0);
      const index = _nav.findIndex(i => i.id === item.id);
      if (index > -1){
        _nav = _nav.slice(0, index + 1);
      } else {
        _nav.push(item);
      }
      return {subNavigation: _nav};
    })
  },

  addSelectedItem(item) {
    set( (state) => {
      let selItems = state.selectedItems.slice(0);
      selItems.push(item);
      return {selectedItems: selItems};
    })
  },

  removeSelectedItem(item) {
    set( (state) => {
      let selItems = state.selectedItems.slice(0);
      let index = selItems.findIndex( i => i.id === item.id);
      if ( index > -1 ) {
        selItems.splice(index, 1);
      }
      return {selectedItems: selItems};
    })
  },
  clearSelectedItems() {
    return set((state) => ({selectedItems: []}))
  }
}));

export default useAppState;