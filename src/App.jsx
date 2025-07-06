import React, { useState, useCallback } from 'react';
import { Upload, FileX, Check, X, Eye, EyeOff, AlertTriangle, CheckCircle, Download, BarChart3 } from 'lucide-react';

const ExcelComparison = () => {
  const [files, setFiles] = useState({ reference: null, comparison: null });
  const [fileData, setFileData] = useState({ reference: null, comparison: null });
  const [comparisonResults, setComparisonResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentView, setCurrentView] = useState('upload');
  const [showMissingOnly, setShowMissingOnly] = useState(false);

  const handleFileUpload = useCallback(async (file, type) => {
    if (!file) return;
    
    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      let parsedData = {};
      
      if (type === 'reference') {
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        
        const headerRowIndex = 3;
        const headers = rawData[headerRowIndex];
        
        const dataRows = rawData.slice(headerRowIndex + 1).filter(row => 
          row.some(cell => cell !== '') && row[3] === 'Invoice'
        );
        
        parsedData = {
          type: 'generalLedger',
          headers,
          data: dataRows.map(row => {
            // Handle date conversion only for display, keep original for comparison
            let displayDate = row[2];
            if (typeof displayDate === 'number' && displayDate > 40000) {
              // Convert Excel serial date to readable format
              const excelDate = new Date((displayDate - 25569) * 86400 * 1000);
              displayDate = excelDate.toLocaleDateString('en-US');
            }
            
            return {
              account: row[1] || '',
              date: displayDate || '',
              type: row[3] || '',
              number: String(row[4] || '').trim(),
              name: row[5] || '',
              splitAccount: row[6] || '',
              amount: parseFloat(row[7]) || 0,
              balance: parseFloat(row[8]) || 0
            };
          }).filter(item => item.number)
        };
      } else {
        const individualSheet = workbook.Sheets['Individual_Invoices'];
        
        if (!individualSheet) {
          throw new Error('Individual_Invoices sheet not found in the uploaded file');
        }
        
        const individualData = XLSX.utils.sheet_to_json(individualSheet, { header: 1 });
        const headers = individualData[0];
        const dataRows = individualData.slice(1).filter(row => row.some(cell => cell !== ''));
        
        parsedData = {
          type: 'invoice',
          individual: {
            headers,
            data: dataRows.map(row => ({
              invoiceNumber: String(row[0] || '').trim(),
              customerName: row[1] || '',
              customerId: row[2] || '',
              productAmount: parseFloat(row[3]) || 0,
              miscCharges: parseFloat(row[4]) || 0,
              subtotal: parseFloat(row[5]) || 0,
              totalAmount: parseFloat(row[6]) || 0,
              businessDate: row[7] || '',
              printDate: row[8] || ''
            })).filter(item => item.invoiceNumber)
          }
        };
      }
      
      setFiles(prev => ({ ...prev, [type]: file }));
      setFileData(prev => ({ ...prev, [type]: parsedData }));
      
      console.log(`${type} file processed:`, parsedData);
      
    } catch (error) {
      console.error('Error parsing file:', error);
      alert(`Error parsing ${type} file: ${error.message}. Please ensure it's a valid Excel file with the expected structure.`);
    } finally {
      setLoading(false);
    }
  }, []);

  const compareFiles = useCallback(async () => {
    if (!fileData.reference || !fileData.comparison) {
      alert('Please upload both files before comparing.');
      return;
    }
    
    setLoading(true);
    try {
      const glData = fileData.reference.data;
      const invoiceData = fileData.comparison.individual.data;
      
      if (!glData || !invoiceData) {
        throw new Error('Unable to extract data from uploaded files');
      }
      
      console.log('Comparing data:', { glEntries: glData.length, invoiceEntries: invoiceData.length });
      
      // Create simple lookup maps - focus only on invoice numbers
      const glByInvoiceNumber = new Map();
      glData.forEach(item => {
        if (item.number) {
          const cleanNumber = String(item.number).trim();
          glByInvoiceNumber.set(cleanNumber, item);
        }
      });
      
      const invoiceByNumber = new Map();
      invoiceData.forEach(item => {
        if (item.invoiceNumber) {
          const cleanNumber = String(item.invoiceNumber).trim();
          invoiceByNumber.set(cleanNumber, item);
        }
      });
      
      console.log('GL Invoice Numbers (first 5):', Array.from(glByInvoiceNumber.keys()).slice(0, 5));
      console.log('Invoice Numbers (first 5):', Array.from(invoiceByNumber.keys()).slice(0, 5));
      
      const matches = [];
      const missingFromGL = [];
      const missingFromInvoice = [];
      const amountMismatches = [];
      
      // Check each invoice against GL - simple invoice number and amount comparison
      invoiceData.forEach(invoice => {
        const invoiceNum = String(invoice.invoiceNumber || '').trim();
        
        if (!invoiceNum) return;
        
        const glEntry = glByInvoiceNumber.get(invoiceNum);
        
        if (glEntry) {
          // Found matching invoice number - compare amounts
          const invoiceAmount = parseFloat(invoice.totalAmount) || 0;
          const glAmount = parseFloat(glEntry.amount) || 0;
          const amountDiff = Math.abs(invoiceAmount - glAmount);
          
          console.log(`Comparing ${invoiceNum}: Invoice=${invoiceAmount}, GL=${glAmount}, Diff=${amountDiff}`);
          
          if (amountDiff > 0.01) {
            // Amounts don't match
            amountMismatches.push({
              invoice,
              glEntry,
              difference: amountDiff
            });
          } else {
            // Perfect match - invoice number and amount both correct
            matches.push({ invoice, glEntry });
          }
        } else {
          // Invoice not found in GL
          missingFromGL.push(invoice);
        }
      });
      
      // Check GL entries not in invoices
      glData.forEach(glEntry => {
        const invoiceNum = String(glEntry.number || '').trim();
        if (invoiceNum && !invoiceByNumber.has(invoiceNum)) {
          missingFromInvoice.push(glEntry);
        }
      });
      
      const totalIssues = missingFromGL.length + missingFromInvoice.length + amountMismatches.length;
      const accuracyPercentage = Math.round((matches.length / Math.max(invoiceData.length, 1)) * 100);
      
      const results = {
        matches,
        missingFromGL,
        missingFromInvoice,
        amountMismatches,
        summary: {
          totalInvoices: invoiceData.length,
          totalGLEntries: glData.length,
          matchCount: matches.length,
          missingFromGLCount: missingFromGL.length,
          missingFromInvoiceCount: missingFromInvoice.length,
          amountMismatchCount: amountMismatches.length,
          totalIssues,
          accuracyPercentage
        }
      };
      
      console.log('Comparison results:', results);
      
      setComparisonResults(results);
      setCurrentView('compare');
      
      // Show summary alert
      alert(`Comparison Complete!\n\n` +
            `✓ Perfect Matches: ${matches.length}\n` +
            `✗ Missing from GL: ${missingFromGL.length}\n` +
            `✗ Missing from Invoices: ${missingFromInvoice.length}\n` +
            `⚠ Amount Mismatches: ${amountMismatches.length}\n\n` +
            `Accuracy: ${accuracyPercentage}%`);
      
    } catch (error) {
      console.error('Error comparing files:', error);
      alert(`Error during comparison: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [fileData]);

  const FileUploadZone = ({ type, title, accept = ".xlsx,.xls" }) => {
    const handleDrop = useCallback((e) => {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        handleFileUpload(droppedFile, type);
      }
    }, [type]);

    const handleDragOver = useCallback((e) => {
      e.preventDefault();
    }, []);

    const handleFileChange = useCallback((e) => {
      const selectedFile = e.target.files[0];
      if (selectedFile) {
        handleFileUpload(selectedFile, type);
      }
    }, [type]);

    const isUploaded = files[type] !== null;

    return (
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isUploaded 
            ? 'border-green-300 bg-green-50' 
            : 'border-gray-300 hover:border-blue-400 bg-gray-50'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          type="file"
          accept={accept}
          onChange={handleFileChange}
          className="hidden"
          id={`file-${type}`}
        />
        <label htmlFor={`file-${type}`} className="cursor-pointer">
          {isUploaded ? (
            <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-4" />
          ) : (
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          )}
          <div className="text-lg font-medium text-gray-900 mb-2">{title}</div>
          {isUploaded ? (
            <div className="text-sm text-green-600">
              <div>✓ {files[type].name}</div>
              <div className="mt-1">Ready for comparison</div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              <div>Drop your Excel file here or click to browse</div>
              <div className="mt-1">Supports .xlsx and .xls formats</div>
            </div>
          )}
        </label>
      </div>
    );
  };

  const ComparisonView = () => {
    if (!comparisonResults) return null;

    const { summary } = comparisonResults;
    const accuracyPercentage = summary.accuracyPercentage || Math.round((summary.matchCount / Math.max(summary.totalInvoices, 1)) * 100);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <div className="text-2xl font-bold text-blue-700">{summary.matchCount}</div>
            <div className="text-sm text-blue-600">Perfect Matches</div>
          </div>
          <div className="bg-red-50 p-4 rounded-lg border border-red-200">
            <div className="text-2xl font-bold text-red-700">{summary.missingFromGLCount}</div>
            <div className="text-sm text-red-600">Missing from GL</div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
            <div className="text-2xl font-bold text-orange-700">{summary.missingFromInvoiceCount}</div>
            <div className="text-sm text-orange-600">Missing from Invoices</div>
          </div>
        </div>

        {/* Amount Mismatches - only show if there are any */}
        {summary.amountMismatchCount > 0 && (
          <div className="grid grid-cols-1 gap-4">
            <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
              <div className="text-2xl font-bold text-yellow-700">{summary.amountMismatchCount}</div>
              <div className="text-sm text-yellow-600">Amount Mismatches</div>
            </div>
          </div>
        )}

        <div className="bg-gradient-to-r from-blue-500 to-green-500 p-6 rounded-lg text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold">{accuracyPercentage}%</div>
              <div className="text-blue-100">Data Accuracy Score</div>
            </div>
            <BarChart3 className="h-12 w-12 text-blue-200" />
          </div>
        </div>

        <div className="flex items-center justify-between bg-gray-50 p-4 rounded-lg">
          <button
            onClick={() => setShowMissingOnly(!showMissingOnly)}
            className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            {showMissingOnly ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            <span>{showMissingOnly ? 'Show All' : 'Show Issues Only'}</span>
          </button>
          
          <button
            onClick={() => setCurrentView('visual')}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Visual Comparison
          </button>
        </div>

        <div className="space-y-4">
          {(!showMissingOnly && comparisonResults.matches.length > 0) && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="font-semibold text-green-800 mb-3 flex items-center">
                <Check className="h-5 w-5 mr-2" />
                Perfect Matches ({comparisonResults.matches.length})
              </h3>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-green-200">
                      <th className="p-2">Invoice #</th>
                      <th className="p-2">Customer</th>
                      <th className="p-2">Amount</th>
                      <th className="p-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonResults.matches.slice(0, 20).map((match, i) => (
                      <tr key={i} className="border-b border-green-100">
                        <td className="p-2 font-mono">{match.invoice.invoiceNumber}</td>
                        <td className="p-2">{match.invoice.customerName}</td>
                        <td className="p-2">${match.invoice.totalAmount.toFixed(2)}</td>
                        <td className="p-2">{match.invoice.businessDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {comparisonResults.missingFromGL.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="font-semibold text-red-800 mb-3 flex items-center">
                <X className="h-5 w-5 mr-2" />
                Missing from General Ledger ({comparisonResults.missingFromGL.length})
              </h3>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-red-200">
                      <th className="p-2">Invoice #</th>
                      <th className="p-2">Customer</th>
                      <th className="p-2">Amount</th>
                      <th className="p-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonResults.missingFromGL.map((invoice, i) => (
                      <tr key={i} className="border-b border-red-100">
                        <td className="p-2 font-mono text-red-700">{invoice.invoiceNumber}</td>
                        <td className="p-2">{invoice.customerName}</td>
                        <td className="p-2">${invoice.totalAmount.toFixed(2)}</td>
                        <td className="p-2">{invoice.businessDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {comparisonResults.missingFromInvoice.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <h3 className="font-semibold text-orange-800 mb-3 flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2" />
                In General Ledger but Missing from Invoices ({comparisonResults.missingFromInvoice.length})
              </h3>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-orange-200">
                      <th className="p-2">Invoice #</th>
                      <th className="p-2">Customer</th>
                      <th className="p-2">Amount</th>
                      <th className="p-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonResults.missingFromInvoice.map((glEntry, i) => (
                      <tr key={i} className="border-b border-orange-100">
                        <td className="p-2 font-mono text-orange-700">{glEntry.number}</td>
                        <td className="p-2">{glEntry.name}</td>
                        <td className="p-2">${glEntry.amount.toFixed(2)}</td>
                        <td className="p-2">{glEntry.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {comparisonResults.amountMismatches.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h3 className="font-semibold text-yellow-800 mb-3 flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2" />
                Amount Mismatches ({comparisonResults.amountMismatches.length})
              </h3>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-yellow-200">
                      <th className="p-2">Invoice #</th>
                      <th className="p-2">Customer</th>
                      <th className="p-2">Invoice Amount</th>
                      <th className="p-2">GL Amount</th>
                      <th className="p-2">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonResults.amountMismatches.map((mismatch, i) => (
                      <tr key={i} className="border-b border-yellow-100">
                        <td className="p-2 font-mono text-yellow-700">{mismatch.invoice.invoiceNumber}</td>
                        <td className="p-2">{mismatch.invoice.customerName}</td>
                        <td className="p-2">${mismatch.invoice.totalAmount.toFixed(2)}</td>
                        <td className="p-2">${mismatch.glEntry.amount.toFixed(2)}</td>
                        <td className="p-2 font-semibold text-red-600">${mismatch.difference.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const VisualComparisonView = () => {
    if (!comparisonResults) return null;

    const { summary } = comparisonResults;
    const data = [
      { label: 'Perfect Matches', value: summary.matchCount, color: 'bg-green-500' },
      { label: 'Missing from GL', value: summary.missingFromGLCount, color: 'bg-red-500' },
      { label: 'Missing from Invoice', value: summary.missingFromInvoiceCount, color: 'bg-orange-500' },
      { label: 'Amount Mismatches', value: summary.amountMismatchCount, color: 'bg-yellow-500' }
    ];

    const total = data.reduce((sum, item) => sum + item.value, 0);

    return (
      <div className="space-y-8">
        <div className="bg-white p-8 rounded-lg border shadow-sm">
          <h3 className="text-2xl font-bold mb-8 text-center text-gray-800">Data Comparison Overview</h3>
          
          {/* Summary Cards Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            {data.map((item, i) => {
              const percentage = total > 0 ? (item.value / total) * 100 : 0;
              const colorMap = {
                'bg-green-500': 'bg-green-50 border-green-200 text-green-700',
                'bg-red-500': 'bg-red-50 border-red-200 text-red-700',
                'bg-orange-500': 'bg-orange-50 border-orange-200 text-orange-700',
                'bg-yellow-500': 'bg-yellow-50 border-yellow-200 text-yellow-700',
                'bg-purple-500': 'bg-purple-50 border-purple-200 text-purple-700'
              };
              
              return (
                <div key={i} className={`p-4 rounded-lg border-2 ${colorMap[item.color]} text-center`}>
                  <div className="text-2xl font-bold mb-1">{item.value}</div>
                  <div className="text-xs font-medium mb-2">{item.label}</div>
                  <div className="text-sm font-semibold">{percentage.toFixed(1)}%</div>
                </div>
              );
            })}
          </div>

          {/* Modern Progress Bars */}
          <div className="space-y-4 mb-8">
            {data.map((item, i) => {
              const percentage = total > 0 ? (item.value / total) * 100 : 0;
              if (percentage === 0) return null;
              
              return (
                <div key={i} className="bg-gray-100 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-medium text-gray-700">{item.label}</span>
                    <span className="text-sm font-semibold text-gray-600">{item.value} items ({percentage.toFixed(1)}%)</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                      className={`${item.color} h-3 rounded-full transition-all duration-1000 ease-out shadow-sm`}
                      style={{ width: `${Math.max(percentage, 2)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Enhanced Donut Chart */}
          <div className="flex flex-col lg:flex-row items-center justify-center gap-8">
            <div className="relative">
              <svg width="200" height="200" viewBox="0 0 200 200" className="transform -rotate-90">
                <circle
                  cx="100"
                  cy="100"
                  r="80"
                  fill="none"
                  stroke="#f3f4f6"
                  strokeWidth="20"
                />
                {(() => {
                  let cumulativePercentage = 0;
                  return data.map((item, i) => {
                    const percentage = total > 0 ? (item.value / total) * 100 : 0;
                    if (percentage === 0) return null;
                    
                    const circumference = 2 * Math.PI * 80;
                    const strokeDasharray = circumference;
                    const strokeDashoffset = circumference - (percentage / 100) * circumference;
                    const rotation = (cumulativePercentage / 100) * 360;
                    
                    cumulativePercentage += percentage;
                    
                    const colors = {
                      'bg-green-500': '#10b981',
                      'bg-red-500': '#ef4444',
                      'bg-orange-500': '#f97316',
                      'bg-yellow-500': '#eab308',
                      'bg-purple-500': '#8b5cf6'
                    };

                    return (
                      <circle
                        key={i}
                        cx="100"
                        cy="100"
                        r="80"
                        fill="none"
                        stroke={colors[item.color]}
                        strokeWidth="20"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        style={{
                          transformOrigin: '100px 100px',
                          transform: `rotate(${rotation}deg)`
                        }}
                        className="transition-all duration-1000"
                      />
                    );
                  });
                })()}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-3xl font-bold text-gray-900">{total}</div>
                <div className="text-sm text-gray-500 font-medium">Total Items</div>
              </div>
            </div>
            
            {/* Legend */}
            <div className="grid grid-cols-1 gap-3">
              {data.map((item, i) => {
                const percentage = total > 0 ? (item.value / total) * 100 : 0;
                if (percentage === 0) return null;
                
                const colors = {
                  'bg-green-500': '#10b981',
                  'bg-red-500': '#ef4444',
                  'bg-orange-500': '#f97316',
                  'bg-yellow-500': '#eab308',
                  'bg-purple-500': '#8b5cf6'
                };
                
                return (
                  <div key={i} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50">
                    <div 
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: colors[item.color] }}
                    ></div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-700">{item.label}</div>
                      <div className="text-sm text-gray-500">{item.value} items ({percentage.toFixed(1)}%)</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-blue-800 mb-4 flex items-center">
              <FileX className="h-5 w-5 mr-2" />
              Invoice File Summary
            </h4>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>Total Invoices:</span>
                <span className="font-semibold">{summary.totalInvoices}</span>
              </div>
              <div className="flex justify-between">
                <span>File Name:</span>
                <span className="font-semibold text-sm">invoice.xlsx</span>
              </div>
              <div className="flex justify-between">
                <span>Sheets:</span>
                <span className="font-semibold">Individual_Invoices</span>
              </div>
            </div>
          </div>

          <div className="bg-green-50 p-6 rounded-lg border border-green-200">
            <h4 className="font-semibold text-green-800 mb-4 flex items-center">
              <FileX className="h-5 w-5 mr-2" />
              General Ledger Summary
            </h4>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>Total GL Entries:</span>
                <span className="font-semibold">{summary.totalGLEntries}</span>
              </div>
              <div className="flex justify-between">
                <span>Account Type:</span>
                <span className="font-semibold">Accounts Receivable</span>
              </div>
              <div className="flex justify-between">
                <span>Transaction Type:</span>
                <span className="font-semibold">Invoice</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-center space-x-4">
          <button
            onClick={() => setCurrentView('compare')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            View Detailed Results
          </button>
          <button
            onClick={() => {
              alert('Export functionality would generate a detailed Excel report with all discrepancies');
            }}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
          >
            <Download className="h-4 w-4" />
            <span>Export Report</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Excel File Comparison Tool</h1>
          <p className="text-gray-600">
            Compare your General Ledger with Invoice data to ensure accuracy and identify discrepancies
          </p>
        </div>

        {(files.reference && files.comparison) && (
          <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
            <div className="flex space-x-4">
              <button
                onClick={() => setCurrentView('upload')}
                className={`px-4 py-2 rounded-md ${currentView === 'upload' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
              >
                Upload Files
              </button>
              <button
                onClick={() => setCurrentView('compare')}
                className={`px-4 py-2 rounded-md ${currentView === 'compare' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                disabled={!comparisonResults}
              >
                Detailed Comparison
              </button>
              <button
                onClick={() => setCurrentView('visual')}
                className={`px-4 py-2 rounded-md ${currentView === 'visual' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                disabled={!comparisonResults}
              >
                Visual Overview
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm p-6">
          {currentView === 'upload' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <FileUploadZone 
                  type="reference" 
                  title="General Ledger (Reference Data)"
                />
                <FileUploadZone 
                  type="comparison" 
                  title="Invoice File (Data to Verify)"
                />
              </div>

              {files.reference && files.comparison && (
                <div className="flex justify-center">
                  <button
                    onClick={compareFiles}
                    disabled={loading}
                    className="px-8 py-4 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-lg font-semibold flex items-center space-x-2"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        <span>Comparing...</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-5 w-5" />
                        <span>Compare Files</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h3 className="font-semibold text-blue-800 mb-3">How to use this tool:</h3>
                <ol className="list-decimal list-inside space-y-2 text-blue-700">
                  <li>Upload your General Ledger file (the correct/reference data) on the left</li>
                  <li>Upload your Invoice file (the data you want to verify) on the right</li>
                  <li>Click "Compare Files" to analyze the differences</li>
                  <li>Review the results in detailed or visual format</li>
                  <li>Export the findings for further action</li>
                </ol>
              </div>
            </div>
          )}

          {currentView === 'compare' && <ComparisonView />}
          {currentView === 'visual' && <VisualComparisonView />}
        </div>
      </div>
    </div>
  );
};

export default ExcelComparison;