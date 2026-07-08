import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = "https://savaxzyujesrilzsonqs.supabase.co";
export const supabaseAnonKey = "sb_publishable_XZhfPV18yMBX2yv65R7t1g_as99P7bY";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
