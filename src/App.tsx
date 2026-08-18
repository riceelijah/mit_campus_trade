import { Routes, Route } from 'react-router-dom';
import NavBar from './components/NavBar';
import HomePage from './pages/HomePage';
import CollectionPage from './pages/CollectionPage';
import RulesPage from './pages/RulesPage';
import CardDetailPage from './pages/CardDetailPage';
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import AccountPage from './pages/AccountPage';
import AdminPage from './pages/AdminPage';

export default function App() {
    return (
        <>
            <NavBar />
            <main className="page">
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/collection" element={<CollectionPage />} />
                    <Route path="/rules" element={<RulesPage />} />
                    <Route path="/cards/:highlightId" element={<CardDetailPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/account" element={<AccountPage />} />
                    <Route path="/admin" element={<AdminPage />} />
                </Routes>
            </main>
        </>
    );
}
