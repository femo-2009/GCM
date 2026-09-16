import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://savaxzyujesrilzsonqs.supabase.co";
const supabaseAnonKey = "sb_publishable_XZhfPV18yMBX2yv65R7t1g_as99P7bY";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
