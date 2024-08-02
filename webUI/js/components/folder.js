import React, {useState, useEffect, useCallback, useMemo} from 'react';
import * as Utils from '../utils';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faTrashCan, faFolderClosed, faCopy, faRightLeft, faTrash } from '@fortawesome/free-solid-svg-icons'
import { faFile } from '@fortawesome/free-regular-svg-icons'
import useAppState from '../state';


export function Item(props) {
  const {item, onDoubleClick, onSingleClick, isHighlighted} = props;

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
        {size ? Utils.humanFileSize(size, false, 2) : ''}
      </div>
      <div className="col-1">
        <small>{item.type}</small>
      </div>
      <div className="col-2 text-end">
        <div className="row">
          <div className="col text-center" ><FontAwesomeIcon icon={faPen} className="clickable-item" /></div>
          <div className="col text-center" ><FontAwesomeIcon icon={faCopy} className="clickable-item" /></div>
          <div className="col text-center" ><FontAwesomeIcon icon={faRightLeft} className="clickable-item" /></div>
          <div className="col text-center" ><FontAwesomeIcon icon={faTrash} className="clickable-item" /></div>
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

  const navigateFolder = useAppState((state) => state.navigateFolder);
  const selectedItems = useAppState((state) => state.selectedItems);
  const addSelectedItem = useAppState((state) => state.addSelectedItem);
  const removeSelectedItem = useAppState((state) => state.removeSelectedItem);
  const clearSelectedItems = useAppState((state) => state.clearSelectedItems);

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
        addSelectedItem(itemToSelect);
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

  useEffect(() => {
    async function load() {
      const items = await Utils.getChildren(source.id);
      const folders = items.filter( i => i.type === 'folder').sort( (f1, f2) => f1.filename > f2.filename ? 1 : -1 );
      const files = items.filter( i => i.type !== 'folder').sort( (f1, f2) => f1.filename > f2.filename ? 1 : -1 );
      setItems( folders.concat( files ) );
      setLoading(false);
    }
    load();
  }, [source])

  return (
    <>
      {loading && (<h5>loading</h5>)}
      {!loading &&
        items.map((item) => {
          if ( (item.type == 'folder' && showFolders) || (item.type != 'folder' && showFiles) ) {
            return (
              <Item key={item.id} item={item} onDoubleClick={onDoubleClick} onSingleClick={onSingleClick} isHighlighted={isSelected(item)} />
            )
          }
        })
      }
    </>
  );
}