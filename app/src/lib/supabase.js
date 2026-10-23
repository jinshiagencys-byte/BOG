import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Vite remplace import.meta.env à la compilation. Une variable absente est
  // une erreur de configuration locale, pas une erreur métier silencieuse.
  console.error(
    '[supabase] VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont requis dans app/.env.local.',
  )
}

export const supabase = createClient(
  url || 'http://localhost:54321',
  anonKey || 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
