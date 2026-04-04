import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

export const supabase = createClient(
  environment.supabaseUrl,
  environment.supabaseKey
);

/**
 * Este se encarga de hacer la conexión con base de datos
 */