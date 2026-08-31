/* ============================================================
   PARKIUM · parkium-api.js
   Capa de conexión con Supabase: autenticación, datos y tiempo real.

   Cargar ANTES el cliente de Supabase (una línea en tu HTML):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="parkium-api.js"></script>

   Luego usa el objeto global  ParkiumAPI  desde tu código.
   Ej:  const plazas = await ParkiumAPI.getPlazas(centroId);
   ============================================================ */

const SUPABASE_URL  = "https://xlspnvwzcwnhlouzxyow.supabase.co";
// Llave pública (anon): es SEGURA en el navegador (RLS protege los datos).
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhsc3Budnd6Y3duaGxvdXp4eW93Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxNDQ0NjYsImV4cCI6MjEwMzcyMDQ2Nn0.Ov0HWjKv5-P8vX3Mlvdh6TbKc3oPwxR-N5842LkB2Yc";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

const ParkiumAPI = {
  db, // por si necesitas el cliente crudo

  /* ---------------- AUTENTICACIÓN ---------------- */
  async registrar(email, password, nombre) {
    const { data, error } = await db.auth.signUp({
      email, password, options: { data: { nombre } }
    });
    if (error) throw error;
    return data.user;
  },

  async login(email, password) {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  },

  async logout() {
    const { error } = await db.auth.signOut();
    if (error) throw error;
  },

  async usuarioActual() {
    const { data } = await db.auth.getUser();
    return data.user; // null si no hay sesión
  },

  async miPerfil() {
    const { data, error } = await db.from("perfiles").select("*").single();
    if (error) throw error;
    return data;
  },

  /* ---------------- CENTROS Y PLAZAS ---------------- */
  async getCentros() {
    const { data, error } = await db
      .from("centros_comerciales").select("*")
      .eq("activo", true).order("nombre");
    if (error) throw error;
    return data;
  },

  // Lee la vista con el estado ya calculado: 'libre' | 'reservada' | 'ocupada'
  async getPlazas(centroId) {
    const { data, error } = await db
      .from("v_plazas_estado").select("*")
      .eq("centro_id", centroId).order("codigo");
    if (error) throw error;
    return data;
  },

  // Resumen para el dashboard (total / disponibles / ocupadas / % ocupación)
  async getResumen(centroId) {
    const plazas = await this.getPlazas(centroId);
    const r = { total: plazas.length, libre: 0, reservada: 0, ocupada: 0 };
    plazas.forEach(p => { r[p.estado] = (r[p.estado] || 0) + 1; });
    r.disponibles = r.libre;
    r.pct_ocupacion = r.total ? Math.round(((r.ocupada + r.reservada) / r.total) * 100) : 0;
    return r;
  },

  /* ---------------- RESERVAS ---------------- */
  async crearReserva(plazaId, centroId, vehiculoId = null, minutosParaLlegar = 15) {
    const user = await this.usuarioActual();
    if (!user) throw new Error("Debes iniciar sesión para reservar.");

    const { data: centro, error: e1 } = await db
      .from("centros_comerciales").select("tarifa_hora").eq("id", centroId).single();
    if (e1) throw e1;

    const expira = new Date(Date.now() + minutosParaLlegar * 60000).toISOString();

    const { data, error } = await db.from("reservas").insert({
      plaza_id: plazaId,
      centro_id: centroId,
      perfil_id: user.id,
      vehiculo_id: vehiculoId,
      estado: "pendiente",
      expira_en: expira,
      tarifa_hora_aplicada: centro.tarifa_hora
    }).select().single();

    if (error) {
      if (error.code === "23505")
        throw new Error("Esa plaza ya fue reservada. Elige otra.");
      throw error;
    }
    return data;
  },

  async misReservas() {
    const { data, error } = await db
      .from("reservas")
      .select("*, plazas(codigo), centros_comerciales(nombre)")
      .order("creada_en", { ascending: false });
    if (error) throw error;
    return data;
  },

  async marcarLlegada(reservaId) {
    const { error } = await db.from("reservas")
      .update({ estado: "activa", hora_llegada: new Date().toISOString() })
      .eq("id", reservaId);
    if (error) throw error;
  },

  async cancelarReserva(reservaId) {
    const { error } = await db.from("reservas")
      .update({ estado: "cancelada" }).eq("id", reservaId);
    if (error) throw error;
  },

  /* ---------------- TIEMPO REAL ---------------- */
  // Ejecuta onCambio() cada vez que cambia una plaza o reserva del centro.
  // Úsalo así:
  //   const canal = ParkiumAPI.suscribirDisponibilidad(centroId, () => refrescarMapa());
  //   // y al salir de la vista:  ParkiumAPI.db.removeChannel(canal);
  suscribirDisponibilidad(centroId, onCambio) {
    const nombreCanal = "disp-" + centroId + "-" + Math.random().toString(36).slice(2, 8);
    return db.channel(nombreCanal)
      .on("postgres_changes",
          { event: "*", schema: "public", table: "plazas",   filter: "centro_id=eq." + centroId },
          onCambio)
      .on("postgres_changes",
          { event: "*", schema: "public", table: "reservas", filter: "centro_id=eq." + centroId },
          onCambio)
      .subscribe();
  }
};