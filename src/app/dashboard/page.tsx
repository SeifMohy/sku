'use client'

import { useState, useEffect } from 'react'
import { ArrowPathIcon } from '@heroicons/react/20/solid'
import { CurrencyDollarIcon, BanknotesIcon, CreditCardIcon, ArrowTrendingUpIcon, InformationCircleIcon } from '@heroicons/react/24/outline'
import { clsx } from 'clsx'
import dynamic from 'next/dynamic'
import KeyFigureCard from '@/components/visualization/key-figure-card'
import type { ChangeType } from '@/components/visualization/key-figure-card'
import { isFacilityAccount } from '@/utils/bankStatementUtils'
import { formatEGP, formatEGPForKeyCard } from '@/lib/format'
import { currencyCache } from '@/lib/services/currencyCache'

// Dynamically import Chart.js components
const Line = dynamic(() => import('react-chartjs-2').then(mod => mod.Line), { ssr: false })

// Icon mapping
const iconMap = {
  CurrencyDollarIcon,
  BanknotesIcon,
  CreditCardIcon,
  ArrowTrendingUpIcon
}

interface DashboardStat {
  title: string;
  value: number;
  change: number;
  changeType: ChangeType;
  icon: keyof typeof iconMap;
  iconColor: string;
  dataSource: string;
  interpretation?: 'positive' | 'negative';
}

interface TimelineItem {
  id: number;
  amount: number;
  dueDate: string;
  status?: string;
  confidence?: number;
  description?: string;
}

interface SupplierPayment extends TimelineItem {
  supplier: string;
}

interface CustomerPayment extends TimelineItem {
  customer: string;
}

interface BankPayment extends TimelineItem {
  bank: string;
  type: string;
}

interface CashPosition {
  date: string;
  openingBalance: number;
  totalInflows: number;
  totalOutflows: number;
  netCashflow: number;
  closingBalance: number;
  transactionCount?: number;
  projectionCount?: number;
  isActual?: boolean;
}

interface DashboardMetadata {
  referenceDate: string;
  referenceDateFormatted: string;
  bankName: string;
  accountNumber?: string;
  note: string;
}

// Types for API responses
interface Bank {
  id: number;
  name: string;
  bankStatements: Array<{
    id: number;
    endingBalance: string | null;
    accountType: string | null;
    accountCurrency?: string | null;
    statementPeriodEnd: Date;
    transactions: Array<any>;
  }>;
}

interface Supplier {
  id: number;
  name: string;
  totalPayables: number;
  dueNext30Days: number;
  lastPayment: string | null;
  nextPayment: string | null;
  status: string;
  country?: string | null;
}

interface Customer {
  id: number;
  name: string;
  totalReceivables: number;
  overdueAmount: number;
  dueNext30Days: number;
  lastPayment: string | null;
  nextPayment: string | null;
  status: string;
  country?: string | null;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStat[]>([]);
  const [timeline, setTimeline] = useState<{
    suppliers: SupplierPayment[];
    customers: CustomerPayment[];
    banks: BankPayment[];
  }>({ suppliers: [], customers: [], banks: [] });
  const [historicalPositions, setHistoricalPositions] = useState<CashPosition[]>([]);
  const [projectedPositions, setProjectedPositions] = useState<CashPosition[]>([]);
  const [metadata, setMetadata] = useState<DashboardMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartLoaded, setChartLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);  const [refreshingProjections, setRefreshingProjections] = useState(false);

  // Load chart.js when component mounts
  useEffect(() => {
    const loadChartJs = async () => {
      const { 
        Chart, 
        CategoryScale, 
        LinearScale, 
        PointElement, 
        LineElement, 
        Title, 
        Tooltip, 
        Legend, 
        Filler 
      } = await import('chart.js');
      
      Chart.register(
        CategoryScale, 
        LinearScale, 
        PointElement, 
        LineElement, 
        Title, 
        Tooltip, 
        Legend, 
        Filler
      );
      
      setChartLoaded(true);
    };
    
    loadChartJs();
  }, []);

  // Calculate total cash using optimized currency conversion
  const calculateTotalCash = async (banks: Bank[]): Promise<number> => {
    let totalPositiveBalance = 0;

    // First, collect all unique currencies from bank statements
    const uniqueCurrencies = new Set<string>();
    for (const bank of banks) {
      for (const statement of bank.bankStatements) {
        const statementCurrency = (statement as any).accountCurrency?.trim() || 'EGP';
        uniqueCurrencies.add(statementCurrency);
      }
    }

    // Preload all currency rates in one API call
    const currencyList = Array.from(uniqueCurrencies).filter(currency => currency !== 'EGP');
    if (currencyList.length > 0) {
      console.log('🔄 Dashboard - Preloading currency rates for:', currencyList);
      await currencyCache.preloadRates(currencyList);
    }

    for (const bank of banks) {
      let totalCashBalanceEGP = 0;
      
      console.log(`\n🏦 Dashboard - Processing bank: ${bank.name}`);
      
      // Process each bank statement
      for (const statement of bank.bankStatements) {
        const endingBalance = parseFloat(statement.endingBalance?.toString() || '0');
        const statementCurrency = (statement as any).accountCurrency?.trim() || 'EGP';
        
        console.log(`  📋 Dashboard - Statement ${statement.id}: ${endingBalance} ${statementCurrency}`);
        
        // Convert amount to EGP if needed using cached rates
        let balanceInEGP = endingBalance;
        if (statementCurrency !== 'EGP' && endingBalance !== 0) {
          try {
            const conversion = await currencyCache.convertCurrency(
              Math.abs(endingBalance),
              statementCurrency,
              'EGP'
            );
            
            balanceInEGP = endingBalance < 0 ? -conversion.convertedAmount : conversion.convertedAmount;
            console.log(`💱 Dashboard - Converted ${endingBalance} ${statementCurrency} to ${balanceInEGP} EGP for ${bank.name} (cached)`);
          } catch (error) {
            console.error('Dashboard - Currency conversion error:', error);
            // Fallback to default rate
            const defaultRate = statementCurrency === 'USD' ? 50 : 1;
            balanceInEGP = endingBalance * defaultRate;
            console.log(`❌ Dashboard - Conversion failed, using default rate: ${endingBalance} × ${defaultRate} = ${balanceInEGP} EGP`);
          }
        }
        
        // Determine if this is a facility account using the same logic as banks page
        const isFacility = isFacilityAccount(statement.accountType, endingBalance);
        
        console.log(`  💳 Dashboard - Account Type: ${statement.accountType}, Is Facility: ${isFacility}, Balance in EGP: ${balanceInEGP}`);
        
        if (!isFacility) {
          // Regular account - both positive and negative balances contribute to cash position (same as banks page)
          totalCashBalanceEGP += balanceInEGP; // This can be negative for current accounts
          totalPositiveBalance += balanceInEGP; // Include negative balances in total cash calculation
          
          console.log(`  🏦 Dashboard - Regular Account: +${balanceInEGP} to bank cash, bank total: ${totalCashBalanceEGP}, global total: ${totalPositiveBalance}`);
        }
      }
      
      console.log(`🏦 Dashboard - ${bank.name} FINAL: Cash=${formatEGP(totalCashBalanceEGP)}`);
    }

    console.log(`🏧 Dashboard - System calculated total: ${formatEGP(totalPositiveBalance)}`);
    return totalPositiveBalance;
  };

  // Calculate total payables using the same logic as suppliers page
  const calculateTotalPayables = (suppliers: Supplier[]): number => {
    return suppliers.reduce((sum: number, supplier: Supplier) => sum + supplier.totalPayables, 0);
  };

  // Calculate total receivables using the same logic as customers page
  const calculateTotalReceivables = (customers: Customer[]): number => {
    return customers.reduce((sum: number, customer: Customer) => sum + customer.totalReceivables, 0);
  };

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch data from the same APIs used by individual pages
      const [banksRes, suppliersRes, customersRes, timelineRes, historicalRes] = await Promise.all([
        fetch('/api/banks'),
        fetch('/api/suppliers'),
        fetch('/api/customers'),
        fetch('/api/dashboard/timeline'),
        fetch('/api/dashboard/historical-cashflow')
      ]);

      if (!banksRes.ok || !suppliersRes.ok || !customersRes.ok || !timelineRes.ok || !historicalRes.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const [banksData, suppliersData, customersData, timelineData, historicalData] = await Promise.all([
        banksRes.json(),
        suppliersRes.json(),
        customersRes.json(),
        timelineRes.json(),
        historicalRes.json()
      ]);

      // Calculate totals using the same logic as individual pages
      const totalCash = banksData.success ? await calculateTotalCash(banksData.banks) : 0;
      const totalPayables = Array.isArray(suppliersData) ? calculateTotalPayables(suppliersData) : 0;
      const totalReceivables = Array.isArray(customersData) ? calculateTotalReceivables(customersData) : 0;

      // Get outstanding bank payments from the original dashboard stats API
      const bankPaymentsRes = await fetch('/api/dashboard/stats');
      let outstandingBankPayments = 0;
      let metadata = null;
      
      if (bankPaymentsRes.ok) {
        const bankPaymentsData = await bankPaymentsRes.json();
        if (bankPaymentsData.success) {
          const bankPaymentStat = bankPaymentsData.stats.find(
            (stat: any) => stat.title === 'Outstanding Bank Payments (30 days)'
          );
          outstandingBankPayments = bankPaymentStat?.value || 0;
          metadata = bankPaymentsData.metadata;
        }
      }

      // Create stats array with calculated values
      const calculatedStats: DashboardStat[] = [
        {
          title: 'Total Cash On Hand',
          value: totalCash,
          change: 0, // You might want to calculate this based on historical data
          changeType: 'neutral' as const,
          icon: 'CurrencyDollarIcon',
          iconColor: 'bg-green-500',
          dataSource: 'bankStatements'
        },
        {
          title: 'Outstanding Payables',
          value: totalPayables,
          change: 0, // You might want to calculate this based on historical data
          changeType: 'neutral' as const,
          icon: 'BanknotesIcon',
          iconColor: 'bg-red-500',
          interpretation: 'positive' as const,
          dataSource: 'accountsPayable'
        },
        {
          title: 'Outstanding Receivables',
          value: totalReceivables,
          change: 0, // You might want to calculate this based on historical data
          changeType: 'neutral' as const,
          icon: 'CreditCardIcon',
          iconColor: 'bg-blue-500',
          dataSource: 'accountsReceivable'
        },
        {
          title: 'Outstanding Bank Payments (30 days)',
          value: outstandingBankPayments,
          change: 0,
          changeType: 'neutral' as const,
          icon: 'ArrowTrendingUpIcon',
          iconColor: 'bg-purple-500',
          interpretation: 'negative' as const,
          dataSource: 'bankPosition'
        },
      ];

      setStats(calculatedStats);
      setMetadata(metadata || {
        referenceDate: new Date().toISOString(),
        referenceDateFormatted: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }),
        bankName: banksData.banks?.[0]?.name || 'Multiple Banks',
        accountNumber: '',
        note: 'Data calculated from banks, suppliers, and customers pages'
      });

      if (timelineData.success) {
        setTimeline(timelineData.timeline);
      }

      if (historicalData.success) {
        setHistoricalPositions(historicalData.positions);
      }

      // Fetch projected positions based on the reference date
      const referenceDate = metadata?.referenceDate || new Date().toISOString();
      const nextDay = new Date(referenceDate);
      nextDay.setDate(nextDay.getDate() + 1);

      // Use the unified cashflow API to get projections that align with the cashflow page
      const projectedRes = await fetch(`/api/cashflow/unified?startDate=${nextDay.toISOString().split('T')[0]}&range=30d`);
      if (projectedRes.ok) {
        const projectedData = await projectedRes.json();
        if (projectedData.success) {
          setProjectedPositions(projectedData.positions);
          
          console.log('✅ Dashboard using unified cashflow projections');
          console.log(`   - Total projections: ${projectedData.metadata.totalProjections}`);
          console.log(`   - Starting balance: ${projectedData.metadata.startingBalance}`);
          console.log(`   - Currency: ${projectedData.metadata.currency}`);
        }
      }

    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const refreshProjections = async () => {
    try {
      setRefreshingProjections(true);
      
      console.log('🚀 Dashboard: Starting centralized projection refresh...');
      
      // Use the same centralized refresh endpoint as the cashflow page
      const response = await fetch('/api/cashflow/projections/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: new Date().toISOString().split('T')[0],
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 1 year
          forceRecalculate: true
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log('✅ Dashboard: Centralized projection refresh completed successfully');
        console.log('📊 Summary:', data.summary);
        
        // Refresh the dashboard data to show updated projections
        await fetchDashboardData();
        console.log('✅ Dashboard data refreshed with updated projections');
        
      } else {
        console.error('❌ Dashboard: Projection refresh failed:', data.error);
        throw new Error(`Projection refresh failed: ${data.error}`);
      }
      
    } catch (error) {
      console.error('❌ Dashboard: Error during projection refresh:', error);
      alert(`Failed to refresh projections: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRefreshingProjections(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return formatEGP(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const prepareChartData = () => {
    if (!chartLoaded || (historicalPositions.length === 0 && projectedPositions.length === 0)) {
      return null;
    }

    // Get the Total Cash On Hand from stats
    const totalCashOnHand = stats.find(stat => stat.title === 'Total Cash On Hand')?.value || 0;
    
    // Prepare historical data - adjust the last point to match Total Cash On Hand
    let adjustedHistoricalPositions = [...historicalPositions];
    if (adjustedHistoricalPositions.length > 0 && totalCashOnHand > 0) {
      // Update the last historical data point to match Total Cash On Hand
      const lastIndex = adjustedHistoricalPositions.length - 1;
      adjustedHistoricalPositions[lastIndex] = {
        ...adjustedHistoricalPositions[lastIndex],
        closingBalance: totalCashOnHand
      };
    }

    // Prepare projected data - start from Total Cash On Hand
    let adjustedProjectedPositions = [...projectedPositions];
    if (adjustedProjectedPositions.length > 0 && totalCashOnHand > 0) {
      // Adjust all projected positions to start from Total Cash On Hand
      const firstProjectedBalance = adjustedProjectedPositions[0]?.openingBalance || 0;
      const adjustment = totalCashOnHand - firstProjectedBalance;
      
      adjustedProjectedPositions = adjustedProjectedPositions.map(position => ({
        ...position,
        openingBalance: position.openingBalance + adjustment,
        closingBalance: position.closingBalance + adjustment
      }));
    }

    // Combine and sort all positions
    const allPositions = [...adjustedHistoricalPositions, ...adjustedProjectedPositions];
    const sortedPositions = allPositions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Remove duplicates and ensure smooth transition
    const uniquePositions = [];
    let lastDate = '';
    
    for (const position of sortedPositions) {
      if (position.date !== lastDate) {
        uniquePositions.push(position);
        lastDate = position.date;
      }
    }

    const labels = uniquePositions.map(p => formatDate(p.date));
    const balances = uniquePositions.map(p => p.closingBalance);
    
    // Split data into historical and projected segments
    const historicalEndIndex = adjustedHistoricalPositions.length;
    const historicalBalances = balances.slice(0, historicalEndIndex);
    const projectedBalances = balances.slice(historicalEndIndex - 1); // Include overlap point

    return {
      labels,
      datasets: [
        {
          label: 'Historical Cash Position',
          data: [...historicalBalances, ...new Array(Math.max(0, projectedBalances.length - 1)).fill(null)],
          borderColor: 'rgb(34, 197, 94)',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.1,
          fill: false
        },
        {
          label: 'Projected Cash Position',
          data: [...new Array(Math.max(0, historicalEndIndex - 1)).fill(null), ...projectedBalances],
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.1,
          fill: false
        }
      ]
    };
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          padding: 20,
          usePointStyle: true,
          font: {
            size: 14
          }
        }
      },
      title: {
        display: true,
        text: 'Cash Flow Position - Historical & Projected',
        font: {
          size: 16,
          weight: 'bold' as const
        },
        padding: {
          top: 10,
          bottom: 30
        }
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(255, 255, 255, 0.2)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
        callbacks: {
          label: function(context: any) {
            return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
          }
        }
      }
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: 'Date',
          font: {
            size: 14,
            weight: 'bold' as const
          }
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.1)'
        },
        ticks: {
          maxTicksLimit: 15
        }
      },
      y: {
        display: true,
        title: {
          display: true,
          text: 'Amount (EGP)',
          font: {
            size: 14,
            weight: 'bold' as const
          }
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.1)'
        },
        ticks: {
          callback: function(value: any) {
            return formatCurrency(value);
          }
        }
      }
    },
    interaction: {
      mode: 'nearest' as const,
      axis: 'x' as const,
      intersect: false
    },
    elements: {
      point: {
        hoverRadius: 8
      }
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <ArrowPathIcon className="h-8 w-8 animate-spin text-indigo-600" />
        <span className="ml-2 text-lg">Loading dashboard...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-800 mb-4">Dashboard Error</h1>
          <p className="text-red-600 mb-4">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const chartData = prepareChartData();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="py-10">
        <header>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-3xl font-bold leading-tight tracking-tight text-gray-900">
                  Dashboard
                </h1>
                <p className="mt-2 text-sm text-gray-600">
                  Real-time overview of your financial position and upcoming obligations
                </p>
              </div>
              
              <div className="mt-4 sm:mt-0">
                <button
                  onClick={refreshProjections}
                  disabled={refreshingProjections}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowPathIcon className={`h-4 w-4 mr-2 ${refreshingProjections ? 'animate-spin' : ''}`} />
                  {refreshingProjections ? 'Refreshing...' : 'Refresh Projections'}
                </button>
              </div>
            </div>
            
            {/* Reference Date Information */}
            {metadata && (
              <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start">
                  <InformationCircleIcon className="h-5 w-5 text-blue-400 mt-0.5 mr-3 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-blue-800">
                      Data as of <span className="font-semibold">{metadata.referenceDateFormatted}</span>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </header>
        <main>
          <div className="mx-auto max-w-7xl sm:px-6 lg:px-8">
            
            {/* Key Statistics */}
            <div className="mt-8">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((stat, index) => {
                  const IconComponent = iconMap[stat.icon];
                  return (
                    <KeyFigureCard
                      key={index}
                      title={stat.title}
                      value={formatEGPForKeyCard(stat.value)}
                      icon={IconComponent}
                      iconColor={stat.iconColor}
                      interpretation={stat.interpretation}
                    />
                  );
                })}
              </div>
            </div>

            {/* Cash Flow Chart */}
            <div className="mt-8">
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-medium text-gray-900">
                      Cash Flow Overview
                    </h3>
                    {metadata && (
                      <div className="text-sm text-gray-500">
                        Based on data through {metadata.referenceDateFormatted}
                      </div>
                    )}
                  </div>
                  <div className="h-[32rem] w-full">
                    {chartData && chartLoaded ? (
                      <Line data={chartData} options={chartOptions} />
                    ) : (
                      <div className="flex justify-center items-center h-full">
                        <ArrowPathIcon className="h-8 w-8 animate-spin text-indigo-600" />
                        <span className="ml-2">Loading chart...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline Sections */}
            <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
              
              {/* Supplier Payments */}
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    Upcoming Supplier Payments
                  </h3>
                  <div className="space-y-4">
                    {timeline.suppliers.length > 0 ? (
                      timeline.suppliers.map((payment) => (
                        <div key={payment.id} className="flex justify-between items-center py-3 border-b border-gray-200 last:border-b-0">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{payment.supplier}</p>
                            <p className="text-xs text-gray-500">{formatDate(payment.dueDate)}</p>
                            <p className="text-xs text-gray-400">{payment.description}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-red-600">
                              -{formatEGPForKeyCard(payment.amount)}
                            </p>
                            <span className={clsx(
                              'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
                              payment.status === 'Pending' 
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-blue-100 text-blue-800'
                            )}>
                              {payment.status}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500 text-center py-4">
                        No upcoming supplier payments
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Customer Payments */}
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    Expected Customer Payments
                  </h3>
                  <div className="space-y-4">
                    {timeline.customers.length > 0 ? (
                      timeline.customers.map((payment) => (
                        <div key={payment.id} className="flex justify-between items-center py-3 border-b border-gray-200 last:border-b-0">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{payment.customer}</p>
                            <p className="text-xs text-gray-500">{formatDate(payment.dueDate)}</p>
                            <p className="text-xs text-gray-400">{payment.description}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-green-600">
                              +{formatEGPForKeyCard(payment.amount)}
                            </p>
                            <span className={clsx(
                              'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
                              payment.status === 'Pending' 
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-blue-100 text-blue-800'
                            )}>
                              {payment.status}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500 text-center py-4">
                        No expected customer payments
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Bank Payments */}
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    Upcoming Bank Obligations
                  </h3>
                  <div className="space-y-4">
                    {timeline.banks.length > 0 ? (
                      timeline.banks.map((payment) => (
                        <div key={payment.id} className="flex justify-between items-center py-3 border-b border-gray-200 last:border-b-0">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{payment.bank}</p>
                            <p className="text-xs text-gray-500">{formatDate(payment.dueDate)}</p>
                            <p className="text-xs text-gray-400">{payment.type}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-purple-600">
                              -{formatEGPForKeyCard(payment.amount)}
                            </p>
                            <span className="inline-flex items-center rounded-full bg-purple-100 text-purple-800 px-2 py-1 text-xs font-medium">
                              {payment.type}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500 text-center py-4">
                        No upcoming bank obligations
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
} 