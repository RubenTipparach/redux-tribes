using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class TweeNode {
    public string Title;
    public List<string> Lines = new();
    public string Next;
    public List<(string text, string target)> Choices = new();
}

public class TweeParser
{
    public static Dictionary<string, TweeNode> Parse(string tweeText)
    {
        var nodes = new Dictionary<string, TweeNode>();
        string[] lines = tweeText.Split(new[] { '\n', '\r' }, System.StringSplitOptions.RemoveEmptyEntries);
        TweeNode current = null;

        foreach (var line in lines)
        {
            if (line.StartsWith(":: "))
            {
                current = new TweeNode { Title = line.Substring(3).Trim() };
                nodes[current.Title] = current;
            }
            else if (current != null)
            {
                if (line.Contains("->"))
                {
                    var parts = line.Split("->");
                    current.Lines.Add(parts[0].Trim());
                    current.Next = parts[1].Trim();
                }
                else
                {
                    current.Lines.Add(line.Trim());
                }
            }

            if (line.StartsWith("[[") && line.EndsWith("]]"))
            {
                string inner = line.Substring(2, line.Length - 4);
                var parts = inner.Split('|');
                string text = parts[0].Trim();
                string target = parts.Length > 1 ? parts[1].Trim() : text;
                current.Choices.Add((text, target));
            }
        }

        return nodes;
    }
}