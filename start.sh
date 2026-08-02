#!/bin/bash

# Insighta - AI Voice Business Consultant
# Start script for development

echo "🚀 Starting Insighta..."
echo ""

# Start Backend
echo "📦 Starting Backend (FastAPI) on port 8000..."
cd backend
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 2

# Start Frontend
echo "🎨 Starting Frontend (React + Vite) on port 5173..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ Insighta is running!"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:8000"
echo "   API Docs: http://localhost:8000/docs"
echo ""
echo "   Default Admin: admin@insighta.com / admin123"
echo ""
echo "Press Ctrl+C to stop both servers"

# Trap to kill both processes
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait

