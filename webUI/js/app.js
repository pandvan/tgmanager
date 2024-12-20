import React, {useState, useCallback, useEffect} from 'react';
import useAppState from './state';
import Listing from './components/listing';

import { setAsyncLoadingStart, setAsyncLoadingStop } from './utils';


export default function App() {

  const [ asyncLoading, setAsyncLoading ] = useState(false);

  const setInitialNavigation = useAppState((state) => state.setInitialNavigation);
  const setInitialSubNavigation = useAppState((state) => state.setInitialSubNavigation);
  
  const root = {id: '0000000000', filename: '', type: 'folder'};

  setInitialNavigation([root]);
  setInitialSubNavigation([root]);

  // setAsyncLoadingStart(useCallback(() => {
  //   setAsyncLoading(true);
  // }, []));
  // setAsyncLoadingStop(useCallback(() => {
  //   setAsyncLoading(false);
  // }, []));


  return (
    <div className="container-fluid">
      <Listing skipActions={false} />
      {asyncLoading && (
        <div id="overlayloading">
          <h5>loading...</h5>
        </div>
      )}
    </div>
  )

}