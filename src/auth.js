
import { supabase } from './supabaseClient.js'

export async function loginWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.href, // Redirect back to this page (preserving path)
    },
  })
  if (error) {
    console.error('Google Login Error:', error)
    return { error }
  }
  return { data }
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    console.error('Get Session Error:', error)
    return null
  }
  return data.session
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) console.error('Sign Out Error:', error)
}
