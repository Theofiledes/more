import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("BMO Component Error Boundary Caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-[#9fc28e] border-2 border-[#2d482e] rounded-lg text-[#2d482e] text-[10px] bmo-font flex flex-col items-center justify-center gap-2 my-4">
          <span>(&gt;_&lt;) BMO ENCOUNTERED A TEMPORARY SCREEN RECOVERY.</span>
          <button 
            type="button" 
            onClick={() => this.setState({ hasError: false, error: null })} 
            className="px-3 py-1.5 bg-[#2d482e] text-[#b5d6a7] rounded text-[8px] uppercase font-bold shadow-[1px_1px_0_#b5d6a7]"
          >
            [RESTART SCREEN]
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
