import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useAppState from '../state';
import BreadCrumbs from './breadcrumbs';
import {Folder} from './folder';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faObjectGroup, faPen, faTrash } from '@fortawesome/free-solid-svg-icons';
import { faRightLeft } from '@fortawesome/free-solid-svg-icons/faRightLeft';
import { OverlayDelete, OverlayMerge, OverlayRename } from './overlay';

export default function Listing(props) {
  const navigation = useAppState((state) => state.navigation);
  const navigate = useAppState((state) => state.navigateFolder);
  const selectedItems = useAppState((state) => state.selectedItems);


  const [ showOverlayDelete, setShowOverlayDelete] = useState(false);
  const [ showOverlayMerge, setShowOverlayMerge] = useState(false);
  const [ showOverlayRename, setShowOverlayRename] = useState(false);

  const {skipActions} = props;
  const [currentFolder, setCurrentFolder] = useState(null);


  useEffect(() => {
    if ( navigation && navigation.length ) {
      setCurrentFolder( navigation[ navigation.length - 1 ] );
    }
  }, [navigation]);

  const showActions = useMemo(() => {
    return selectedItems.length > 0 && !skipActions;
  }, [selectedItems, skipActions]);

  const showMergeAction = useMemo(() => {
    if ( selectedItems.length <= 1 ) { return false }
    const folderSelected = selectedItems.find(i => i.type == 'folder');
    const hasNotParts = !folderSelected && !!selectedItems.find(i => !i.parts || i.parts.length <= 0 );
    return showActions && !folderSelected && !hasNotParts;
  }, [showActions, selectedItems]);

  const reloadFolder = useCallback( () => {
    const cf = currentFolder;
    setCurrentFolder(null);
    setTimeout(() => {
      setCurrentFolder(cf)
    }, 100);
  }, [currentFolder]);

  const onEdit = useCallback(() => {
    setShowOverlayRename(true);
  }, [selectedItems]);

  const onAfterDelete = useCallback((err, operationConfirmed) => {
    if ( operationConfirmed ) {
      if ( !err ) {
        alert('Operation completed');
      } else {
        alert('Operation completed with error');
      }
      reloadFolder();
    }
    setShowOverlayDelete(false);
  }, [reloadFolder, setShowOverlayDelete]);

  const onAfterMerge = useCallback((err, operationConfirmed) => {
    if ( operationConfirmed ) {
      if ( !err ) {
        alert('Operation completed');
      } else {
        alert('Operation completed with error');
      }
      reloadFolder();
    }
    setShowOverlayMerge(false);
  }, [reloadFolder, setShowOverlayMerge]);

  const onAfterEdit = useCallback((err, operationConfirmed) => {
    if (operationConfirmed && !err) {
      reloadFolder();
    } else if (err) {
      alert('error occurs');
    }
    setShowOverlayRename(false);
  }, [reloadFolder, setShowOverlayRename]);

  return (
    <div className="row">
      <div className="col-12" >
        <div className="row">
          <div className={!showActions ? 'col-12' : 'col-9'} >
            <BreadCrumbs navigation={navigation} navigate={navigate} />
          </div>
          {showActions && (
            <div className="col-3 text-end" >
              <div className="row">
                {selectedItems.length == 1 && (<div className="col text-center" title="rename"><FontAwesomeIcon icon={faPen} className="clickable-item ms-2" onClick={() => onEdit()} /></div>)}
                <div className="col text-center" ><FontAwesomeIcon icon={faCopy} className="clickable-item" title="copy"/></div>
                <div className="col text-center" ><FontAwesomeIcon icon={faRightLeft} className="clickable-item" title="move"/></div>
                {showMergeAction && <div className="col text-center" ><FontAwesomeIcon icon={faObjectGroup} className="clickable-item" title="merge" onClick={() => setShowOverlayMerge(true)}  /></div>}
                <div className="col text-center" ><FontAwesomeIcon icon={faTrash} className="clickable-item" title="delete" onClick={() => setShowOverlayDelete(true)} /></div>
              </div>
            </div> 
          )}
        </div>
        <div className="row border-top">
          <div className="col-12" >
            {currentFolder && <Folder source={currentFolder} navigate={navigate} showFolders={true} showFiles={true} />}
          </div>
        </div>
      </div>
      {showOverlayDelete && <OverlayDelete items={selectedItems} onClose={onAfterDelete} />}
      {showOverlayMerge && <OverlayMerge items={selectedItems} onClose={onAfterMerge} />}
      {showOverlayRename && <OverlayRename item={selectedItems[0]} onClose={onAfterEdit} />}
    </div>
  )

  

}