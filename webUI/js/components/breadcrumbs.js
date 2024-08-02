import React from 'react';
import useAppState from "../state";
import { faHome } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

export default function BreadCrumbs(props) {

  const {navigation, navigate} = props

  return (
    <>
      {navigation.map( (item, index) => {
        if (index == 0) {
          return <span key={item.id} className="clickable-item"><FontAwesomeIcon icon={faHome} onClick={() => navigate(item)} /> / </span>
        } else {
          return (
            index !== (navigation.length - 1) ?
                <span key={item.id} ><span onClick={() => navigate(item)} className="clickable-item">{item.filename}</span><span> / </span></span>
              : <span key={item.id} >{item.filename} / </span>
          );
        }
      })}
    </>
  )
}