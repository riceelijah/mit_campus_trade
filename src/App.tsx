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
    const { user, loading: authLoading } = useAuth();
    const { settings, loading: settingsLoading } = useSettings();

    // Fail open (real site) while either is still loading, same as the brief flash
    // CollectionPage/AdminPage already accept elsewhere -- a lockdown that's been on since
    // before this page load will settle into place within one render either way, and there's
    // nothing sensitive on the other side of it (see siteLockedDown's doc comment).
    const locked = !authLoading && !settingsLoading && (settings?.siteLockedDown ?? false);
    // Admins always get the full site, lockdown or not, so they can keep working while it's on
    // (and so there's always a way to switch it back off from /admin).
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
