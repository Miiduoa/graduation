/* eslint-disable */
import React, { createContext, useContext } from 'react';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

type Nav = NavigationProp<ParamListBase> | undefined;

const CampusSocialNavContext = createContext<Nav>(undefined);

/** 由 CommunityScreen 注入，讓分頁內子元件能以 HomeStack 層級 navigate（PostDetail、PostCompose 等）。 */
export function CampusSocialNavProvider(props: { navigation: Nav; children: React.ReactNode }) {
  return (
    <CampusSocialNavContext.Provider value={props.navigation}>
      {props.children}
    </CampusSocialNavContext.Provider>
  );
}

export function useCampusSocialStackNav(): Nav {
  return useContext(CampusSocialNavContext);
}
