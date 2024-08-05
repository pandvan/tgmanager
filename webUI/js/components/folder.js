import React, {useState, useEffect, useCallback, useMemo} from 'react';
import * as Utils from '../utils';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faTrashCan, faFolderClosed, faCopy, faRightLeft, faTrash, faDownload, faFileVideo, faFileAudio, faFileImage } from '@fortawesome/free-solid-svg-icons'
import { faFile } from '@fortawesome/free-regular-svg-icons'
import useAppState from '../state';
import { Badge } from 'react-bootstrap';
import { OverlayDelete } from './overlay';



export function Item(props) {
  const {
    item, 
    onDoubleClick, 
    onSingleClick, 
    isHighlighted,
    onDownload,
    onDelete
  } = props;

  const iconType = useMemo(() => (item.type || '').split('/')[0], [item]);

  const size = useMemo(() => {
    if (item.parts) {
      return (item.parts || []).reduce((acc, part) => acc += part.size, 0);
    } else if (item.content_length) {
      return item.content_length;
    }
  }, [item]);

  return (
    <div className={['row border-bottom', isHighlighted ? 'bg-info' : ''].join(' ')}>
      <div className="col-8 clickable-item" onDoubleClick={(e) => onDoubleClick(e, item)} onClick={(e) => onSingleClick(e, item)}>
        <span >
          {item.type == 'folder' ? (
            <FontAwesomeIcon icon={faFolderClosed} />
          ) : (
            <FontAwesomeIcon icon={faFile} />
          )}
          <span className="ms-1">{item.filename}</span>
        </span>
      </div>
      <div className="col-1">
        <small>{size ? Utils.humanFileSize(size, true, 2, true) : ''}</small>
      </div>
      <div className="col-2">
        <Badge pill bg="light" text="dark">
          <span className="d-none d-md-block">{item.type}</span>
        </Badge>
          {(() => {
            if (item.type != 'folder') {
              if (iconType == 'video') {
                return <span className="d-block d-md-none"><FontAwesomeIcon icon={faFileVideo} /></span>
              } else if (iconType == 'audio') {
                return <span className="d-block d-md-none"><FontAwesomeIcon icon={faFileAudio} /></span>
              } else if (iconType == 'image') {
                return <span className="d-block d-md-none"><FontAwesomeIcon icon={faFileImage} /></span>
              } else {
                return <span className="d-block d-md-none"><FontAwesomeIcon icon={faFile}  /></span>
              }
            }
          })()}
        
      </div>
      <div className="col-1 text-end">
        <div className="row">
          <div className="col text-center" >
            {item.type != 'folder' && <FontAwesomeIcon icon={faDownload} className="clickable-item ms-2" onClick={() => onDownload(item)} />}
            <FontAwesomeIcon icon={faPen} className="clickable-item ms-2" />
            <FontAwesomeIcon icon={faCopy} className="clickable-item ms-2" />
            <FontAwesomeIcon icon={faRightLeft} className="clickable-item ms-2" />
            <FontAwesomeIcon icon={faTrash} className="clickable-item ms-2" onClick={() => onDelete(item)}/>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Folder(props) {

  const {source, depth, showFolders, showFiles} = props;
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(-1);

  const [itemToDelete, setItemToDelete] = useState(null)

  const navigateFolder = useAppState((state) => state.navigateFolder);
  const selectedItems = useAppState((state) => state.selectedItems);
  const addSelectedItem = useAppState((state) => state.addSelectedItem);
  const removeSelectedItem = useAppState((state) => state.removeSelectedItem);
  const clearSelectedItems = useAppState((state) => state.clearSelectedItems);


  const reloadFolder = useCallback( async () => {
    const items = await Utils.getChildren(source.id);
    const folders = items.filter( i => i.type === 'folder').sort( (f1, f2) => f1.filename > f2.filename ? 1 : -1 );
    const files = items.filter( i => i.type !== 'folder').sort( (f1, f2) => f1.filename > f2.filename ? 1 : -1 );
    setItems( folders.concat( files ) );
    setLastSelectedIndex(-1);
    setItemToDelete(null);
    setLoading(false);
    clearSelectedItems();
  }, [source, setLastSelectedIndex,    setItemToDelete,    setLoading,    clearSelectedItems]);

  useEffect(() => {
    reloadFolder();
  }, [source, reloadFolder])


  const onDoubleClick = useCallback((e, item) => {
    if ( item.type == 'folder' ) {
      navigateFolder(item);
      clearSelectedItems();
    }
  }, [])

  const isSelected = useCallback((item) => !!selectedItems.find(i => i.id === item.id), [selectedItems]);

  const onSingleClick = useCallback((e, item) => {
    const {metaKey, ctrlKey, shiftKey} = e;
    const isMultiSelection = metaKey || ctrlKey;
    const currentSelectedItemIndex = items.findIndex(i => i.id === item.id );
    if (shiftKey && lastSelectedIndex > -1 ){
      const start = Math.min(currentSelectedItemIndex, lastSelectedIndex);
      const end = Math.max(currentSelectedItemIndex, lastSelectedIndex);
      for ( let i = start; i <= end; i++ ) {
        const itemToSelect = items[ i ];
        if (!isSelected(itemToSelect)) {
          addSelectedItem(itemToSelect);
        }
      }
      return;
    }
    if ( isMultiSelection ) {
      if (isSelected(item)) {
        removeSelectedItem(item);
        setLastSelectedIndex(-1);
        return;
      }
    } else {
      clearSelectedItems();
    }
    setLastSelectedIndex(currentSelectedItemIndex);
    addSelectedItem(item);
  }, [selectedItems, items, isSelected, lastSelectedIndex]);


  const onDownload = useCallback( (item) => {

    const resp = confirm(`Download '${item.filename}'?`);
    if ( !resp ) return;

    const element = document.createElement('a');
    element.setAttribute('href', `/files/${item.id}`);
    element.setAttribute('download', item.filename);
  
    element.style.display = 'none';
    document.body.appendChild(element);
  
    element.click();
  
    document.body.removeChild(element);

  }, []);

  const onDelete = useCallback((item) => {
    setItemToDelete(item);
  }, []);

  const onAfterDelete = useCallback((err, operationConfirmed) => {
    if ( operationConfirmed ) {
      if ( !err ) {
        alert('Operation completed');
      } else {
        alert('Operation completed with error');
      }
      reloadFolder();
    }
    setItemToDelete(null);
  }, [reloadFolder]);

  return (
    <>
      {loading && (<h5>loading</h5>)}
      {!loading &&
        items.map((item) => {
          if ( (item.type == 'folder' && showFolders) || (item.type != 'folder' && showFiles) ) {
            return (
              <Item key={item.id} 
                item={item} 
                onDoubleClick={onDoubleClick} 
                onSingleClick={onSingleClick} 
                isHighlighted={isSelected(item)} 
                onDownload={onDownload}
                onDelete={onDelete}
              />
            )
          }
        })
      }
      {!!itemToDelete && <OverlayDelete items={[itemToDelete]} onClose={onAfterDelete} />}
    </>
  );
}