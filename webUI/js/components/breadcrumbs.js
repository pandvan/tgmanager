import React from 'react';
import useAppState from "../state";
import { faHome } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Breadcrumb } from 'react-bootstrap';

export default function BreadCrumbs(props) {

  const {navigation, navigate} = props

  // return (
    
  //     <Breadcrumb.Item href="#">Home</Breadcrumb.Item>
  //     <Breadcrumb.Item href="https://getbootstrap.com/docs/4.0/components/breadcrumb/">
  //       Library
  //     </Breadcrumb.Item>
  //     <Breadcrumb.Item active>Data</Breadcrumb.Item>
    
  // );

  return (
    <Breadcrumb>
      {navigation.map( (item, index) => {
        if (index == 0) {
          return (
            <Breadcrumb.Item href="#" key={item.id}>
              <FontAwesomeIcon icon={faHome} onClick={() => navigate(item)} />
            </Breadcrumb.Item>
          );
        } else {
          return (
            index !== (navigation.length - 1) ?
              <Breadcrumb.Item key={item.id} href="#" onClick={() => navigate(item)} >{item.filename}</Breadcrumb.Item>
              : <Breadcrumb.Item key={item.id} href="#" active={true} >{item.filename}</Breadcrumb.Item>
          );
        }
      })}
    </Breadcrumb>
  )
}