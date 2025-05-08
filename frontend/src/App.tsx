import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/utils/theme-provider";
import { Signup } from '@/components/auth';
import { Signin } from '@/components/auth/';
import Home from "@/components/pages/Home";
import ViewBlogPage from '@/components/pages/ViewBlogPage';
import CreateNewBlog from '@/components/pages/CreateNewBlog'; 

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Router>
        <Routes>
          <Route path="/signup" element={<Signup />} />
          <Route path="/signin" element={<Signin />} />
          <Route path="/" element={<Home />} />
          <Route path="/blog/:id" element={<ViewBlogPage />} />
          <Route path="/create-blog" element={<CreateNewBlog />} /> 
          <Route path="*" element={<Navigate to="/signin" />} />
        </Routes>
      </Router>
      <Toaster />
    </ThemeProvider>
  );
}
