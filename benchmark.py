import time
import tracemalloc
import statistics

def run_benchmark(target_function, iterations=10, *args, **kwargs):
    """
    Benchmarks a target function for time and memory usage.
    """
    execution_times = []
    peak_memories = []

    print(f"Starting benchmark for: {target_function.__name__}")
    
    for i in range(iterations):
        # Start memory tracking
        tracemalloc.start()
        
        # Start time tracking
        start_time = time.perf_counter()
        
        # Execute function
        target_function(*args, **kwargs)
        
        # End time tracking
        end_time = time.perf_counter()
        
        # End memory tracking
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        # Record metrics
        execution_times.append(end_time - start_time)
        peak_memories.append(peak / 10**6) # Convert to MB

    # Calculate results
    avg_time = statistics.mean(execution_times)
    avg_memory = statistics.mean(peak_memories)

    print(f"--- Results over {iterations} iterations ---")
    print(f"Average Execution Time: {avg_time:.4f} seconds")
    print(f"Average Peak Memory Usage: {avg_memory:.4f} MB")
    
    return avg_time, avg_memory

# Example Usage:
def my_project_logic():
    # Simulate work
    time.sleep(0.1)
    data = [x**2 for x in range(100000)]

if __name__ == "__main__":
    run_benchmark(my_project_logic, iterations=5)
