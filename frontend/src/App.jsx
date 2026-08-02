import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Interview from './pages/Interview';
import Requirements from './pages/Requirements';
import Documents from './pages/Documents';
import ReviewSign from './pages/ReviewSign';
import Submitted from './pages/Submitted';
import Admin from './pages/Admin';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/interview" element={<Interview />} />
          <Route path="/requirements/:id" element={<Requirements />} />
          <Route path="/documents/:id" element={<Documents />} />
          <Route path="/review/:id" element={<ReviewSign />} />
          <Route path="/submitted/:id" element={<Submitted />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              fontFamily: 'Poppins, sans-serif',
              fontSize: '14px',
            },
          }}
        />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;

