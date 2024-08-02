import React, {useState, useCallback, useEffect} from 'react';
import useAppState from './state';
import Listing from './components/listing';


export default function App() {

  const setInitialNavigation = useAppState((state) => state.setInitialNavigation);
  const root = {id: '0000000000', filename: ''};

  setInitialNavigation([{id: '0000000000', filename: '', type: 'folder'}]);

  return (
    <div className="container-fluid">
      <Listing skipActions={false} />
    </div>
  )

}