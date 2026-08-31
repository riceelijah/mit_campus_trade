import { Routes, Route, Navigate } from 'react-router-dom';
import NavBar from './components/NavBar';
import HomePage from './pages/HomePage';
import LockedHomePage from './pages/LockedHomePage';
import CollectionPage from './pages/CollectionPage';
import MyNotesPage from './pages/MyNotesPage';
import RulesPage from './pages/RulesPage';
import CardDetailPage from './pages/CardDetailPage';
import CardInstancePage from './pages/CardInstancePage';
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import AccountPage from './pages/AccountPage';
import AdminPage from './pages/AdminPage';
import { useAuth } from './auth/AuthContext';
import { useSettings } from './settings/SettingsContext';

export default function App() {
    const { user } = useAuth();
    const { settings } = useSettings();

    // Deliberately NOT gated on either context's own `loading` -- that used to fail open (real
    // site) until both resolved, which is exactly what caused a visible flash of the real
    // homepage on every reload while lockdown was on: SettingsContext now seeds `settings` from
    // a localStorage cache of the last real answer (see SettingsContext's own comment), so this
    // is already right from the very first render on a repeat visit, no round-trip wait needed.
    // A true first-ever visit (nothing cached yet) still fails open here -- `settings` is null
    // until that first fetch resolves, and there's nothing sensitive on the other side of it
    // (see siteLockedDown's doc comment) -- unavoidable without server-side rendering.
    const locked = settings?.siteLockedDown ?? false;
    // Admins always get the full site, lockdown or not, so they can keep working while it's on
    // (and so there's always a way to switch it back off from /admin). Still fails to "not an
    // admin" while auth is loading (user is null until then) -- so an admin reloading during
    // lockdown can see a brief flash the *other* way (locked placeholder, then the real site
    // once their session confirms) rather than none at all. Deliberately left as the one
    // remaining flash case: it only affects admins, who already know lockdown is on since they
    // switched it on, versus caching a full User (custody chains and all) just to avoid it too.
    const bypassLockdown = user?.isAdmin ?? false;

    return (
        <>
            <NavBar />
            <main className="page">
                <Routes>
                    <Route path="/" element={locked && !bypassLockdown ? <LockedHomePage /> : <HomePage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/account" element={<AccountPage />} />
                    <Route path="/admin" element={<AdminPage />} />
                    {(!locked || bypassLockdown) && (
                        <>
                            <Route path="/collection" element={<CollectionPage />} />
                            <Route path="/notes" element={<MyNotesPage />} />
                            <Route path="/rules" element={<RulesPage />} />
                            <Route path="/cards/:highlightId" element={<CardDetailPage />} />
                            <Route path="/cards/:highlightId/:uniqueId" element={<CardInstancePage />} />
                        </>
                    )}
                    {/* Catches a bookmarked/shared link to a route the lockdown just removed
                        above (or any other unknown path) and sends it home instead of
                        rendering nothing. */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </main>
        </>
    );
}
