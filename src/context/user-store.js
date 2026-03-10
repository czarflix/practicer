import { createContext, useContext } from 'react'
import { USER_OPTIONS } from './user-options'

export const UserStoreContext = createContext({
  userKey: USER_OPTIONS[0].key,
  activeUser: USER_OPTIONS[0],
  setUserKey: () => {},
  activeTrackKey: 'dsa',
  setActiveTrackKey: () => {},
  options: USER_OPTIONS,
  session: null,
  authLoading: false,
  isAdmin: false,
  signOut: async () => {},
})

export function useCurrentUser() {
  return useContext(UserStoreContext)
}
